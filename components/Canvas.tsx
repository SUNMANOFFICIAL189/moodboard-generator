"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  DragEvent as ReactDragEvent,
} from "react";
import { Stage, Layer, Image as KImage, Transformer, Rect } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { BoardItem, UploadedImage } from "@/lib/types";
import { proxied } from "@/lib/utils";
import { extractFilesFromDataTransfer } from "@/lib/upload-pool";

const GAP = 10;

export type Tool = "select" | "pan";

export interface CanvasHandle {
  exportPNG: () => string | null;
  // Re-centre the viewport on a board-space point so the user can see
  // recently-placed items even if they landed far from the current view.
  focusOn: (boardX: number, boardY: number) => void;
}

export interface MouseEventInfo {
  ctrlOrMeta: boolean;
  shift: boolean;
}

interface Props {
  items: BoardItem[];
  selectedIds: Set<string>;
  tool: Tool;
  spaceHeld: boolean;
  snapEnabled: boolean;
  onSelectionChange: (ids: Set<string>) => void;
  onChange: (id: string, patch: Partial<BoardItem>) => void;
  onChangeMany: (updates: Array<{ id: string; patch: Partial<BoardItem> }>) => void;
  onBringToFront: (id: string) => void;
  onDelete: (id: string) => void;
  onFilesDropped?: (files: File[], dropAtViewport?: { x: number; y: number }) => void;
  getUploadById?: (id: string) => UploadedImage | null;
  onUploadDropped?: (upload: UploadedImage, at: { x: number; y: number }) => void;
}

function snapToNeighbors(
  dragId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  items: BoardItem[],
  threshold = 12,
): { x: number; y: number } {
  let snappedX = x;
  let snappedY = y;
  let dxMin = threshold;
  let dyMin = threshold;

  const dragEdges = {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    cx: x + w / 2,
    cy: y + h / 2,
  };

  for (const other of items) {
    if (other.id === dragId) continue;
    const o = {
      left: other.x,
      right: other.x + other.width,
      top: other.y,
      bottom: other.y + other.height,
      cx: other.x + other.width / 2,
      cy: other.y + other.height / 2,
    };

    const xSnaps = [
      { drag: dragEdges.right, target: o.left - GAP, offset: 0 },
      { drag: dragEdges.left, target: o.right + GAP, offset: 0 },
      { drag: dragEdges.left, target: o.left, offset: 0 },
      { drag: dragEdges.right, target: o.right, offset: 0 },
      { drag: dragEdges.cx, target: o.cx, offset: 0 },
    ];

    for (const s of xSnaps) {
      const d = Math.abs(s.drag - s.target);
      if (d < dxMin) {
        dxMin = d;
        snappedX = s.target - (s.drag - x) + 0;
      }
    }

    const ySnaps = [
      { drag: dragEdges.bottom, target: o.top - GAP, offset: 0 },
      { drag: dragEdges.top, target: o.bottom + GAP, offset: 0 },
      { drag: dragEdges.top, target: o.top, offset: 0 },
      { drag: dragEdges.bottom, target: o.bottom, offset: 0 },
      { drag: dragEdges.cy, target: o.cy, offset: 0 },
    ];

    for (const s of ySnaps) {
      const d = Math.abs(s.drag - s.target);
      if (d < dyMin) {
        dyMin = d;
        snappedY = s.target - (s.drag - y) + 0;
      }
    }
  }

  return { x: snappedX, y: snappedY };
}

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  {
    items,
    selectedIds,
    tool,
    spaceHeld,
    snapEnabled,
    onSelectionChange,
    onChange,
    onChangeMany,
    onBringToFront,
    onDelete,
    onFilesDropped,
    getUploadById,
    onUploadDropped,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef<Map<string, Konva.Image>>(new Map());
  const dragDepth = useRef(0);
  // Snapshot of starting positions for all selected items when a multi-drag
  // begins. Null when a single-item drag or no drag is in progress.
  const multiDragRef = useRef<{
    leaderId: string;
    leaderStart: { x: number; y: number };
    others: Array<{ id: string; dx: number; dy: number }>;
  } | null>(null);
  // Marquee selection state — lives in refs to avoid setState on every
  // pointermove (re-renders the whole canvas).
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeAdditive = useRef(false);
  const marqueeBaseSelection = useRef<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<null | {
    x: number;
    y: number;
    w: number;
    h: number;
  }>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dropActive, setDropActive] = useState(false);

  const panMode = tool === "pan" || spaceHeld;

  // Selected items resolved to live Konva nodes — used by Transformer + multi-drag.
  const selectedNodes = (): Konva.Image[] => {
    const out: Konva.Image[] = [];
    selectedIds.forEach(id => {
      const n = nodeRefs.current.get(id);
      if (n) out.push(n);
    });
    return out;
  };

  // Update Transformer when selection or items change.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const nodes = selectedNodes();
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, items]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset drop overlay on terminal drag events anywhere in the window.
  useEffect(() => {
    function clearOverlay() {
      dragDepth.current = 0;
      setDropActive(false);
    }
    window.addEventListener("dragend", clearOverlay);
    window.addEventListener("drop", clearOverlay);
    return () => {
      window.removeEventListener("dragend", clearOverlay);
      window.removeEventListener("drop", clearOverlay);
    };
  }, []);

  // Delete / Backspace removes all selected items (when not in an input).
  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
    }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIds.size > 0) {
        if (isEditable(e.target)) return;
        e.preventDefault();
        selectedIds.forEach(id => onDelete(id));
        onSelectionChange(new Set());
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, onDelete, onSelectionChange]);

  useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const stage = stageRef.current;
      if (!stage) return null;
      return stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    },
    focusOn: (boardX: number, boardY: number) => {
      // Place (boardX, boardY) at the visual centre of the viewport.
      // Math: screen = stagePos + board * scale, so for screen = centre:
      //       stagePos = centre - board * scale
      // Leave a slight upward bias so new items have a bit of space below.
      const cx = size.w / 2;
      const cy = size.h * 0.35;
      setStagePos({ x: cx - boardX * scale, y: cy - boardY * scale });
    },
  }));

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.max(0.2, Math.min(4, oldScale * (1 + direction * 0.08)));
    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  function pageToBoard(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - stagePos.x) / scale,
      y: (sy - stagePos.y) / scale,
    };
  }

  function stagePointerToBoard(): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: (p.x - stagePos.x) / scale, y: (p.y - stagePos.y) / scale };
  }

  // ─── Image click — single, additive, or toggle ────────────────────────────

  const handleImageClick = useCallback(
    (id: string, info: MouseEventInfo) => {
      if (info.ctrlOrMeta) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onSelectionChange(next);
      } else if (selectedIds.has(id) && selectedIds.size > 1) {
        // Don't shrink an existing multi-selection on a plain click — that's
        // the start of a multi-drag in most design tools. Just bring to front.
        onBringToFront(id);
      } else {
        onSelectionChange(new Set([id]));
        onBringToFront(id);
      }
    },
    [selectedIds, onSelectionChange, onBringToFront],
  );

  // ─── Marquee selection ────────────────────────────────────────────────────

  function startMarquee(additive: boolean) {
    const at = stagePointerToBoard();
    if (!at) return;
    marqueeStartRef.current = at;
    marqueeAdditive.current = additive;
    marqueeBaseSelection.current = additive ? new Set(selectedIds) : new Set();
    setMarqueeRect({ x: at.x, y: at.y, w: 0, h: 0 });
  }

  function updateMarquee() {
    const start = marqueeStartRef.current;
    if (!start) return;
    const at = stagePointerToBoard();
    if (!at) return;
    const r = {
      x: Math.min(start.x, at.x),
      y: Math.min(start.y, at.y),
      w: Math.abs(at.x - start.x),
      h: Math.abs(at.y - start.y),
    };
    setMarqueeRect(r);
  }

  function finishMarquee() {
    const start = marqueeStartRef.current;
    const rect = marqueeRect;
    marqueeStartRef.current = null;

    if (!start || !rect || rect.w < 2 || rect.h < 2) {
      // Treated as a click on empty area — clear selection unless additive.
      if (!marqueeAdditive.current) onSelectionChange(new Set());
      setMarqueeRect(null);
      return;
    }

    const hits = new Set<string>(marqueeBaseSelection.current);
    for (const it of items) {
      if (
        rectsIntersect(rect, {
          x: it.x,
          y: it.y,
          w: it.width,
          h: it.height,
        })
      ) {
        hits.add(it.id);
      }
    }
    onSelectionChange(hits);
    setMarqueeRect(null);
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Only act on clicks on the Stage itself, not on a node.
    if (e.target !== e.target.getStage()) return;
    if (panMode) return; // pan mode handles its own drag via Stage draggable

    // Left button only (button 0).
    if (e.evt.button !== 0) return;

    startMarquee(e.evt.shiftKey);
  }

  function handleStageMouseMove() {
    if (!marqueeStartRef.current) return;
    updateMarquee();
  }

  function handleStageMouseUp() {
    if (!marqueeStartRef.current) return;
    finishMarquee();
  }

  // ─── Multi-drag coordination ──────────────────────────────────────────────

  const onItemDragStart = useCallback(
    (id: string, leader: Konva.Image) => {
      // If the dragged item isn't selected, treat it as a single-click drag:
      // make it the only selection.
      if (!selectedIds.has(id)) {
        onSelectionChange(new Set([id]));
        multiDragRef.current = null;
        return;
      }
      if (selectedIds.size <= 1) {
        multiDragRef.current = null;
        return;
      }
      // Capture offsets of all OTHER selected items relative to the leader.
      const leaderStart = { x: leader.x(), y: leader.y() };
      const others: Array<{ id: string; dx: number; dy: number }> = [];
      selectedIds.forEach(sid => {
        if (sid === id) return;
        const n = nodeRefs.current.get(sid);
        if (n) {
          others.push({
            id: sid,
            dx: n.x() - leaderStart.x,
            dy: n.y() - leaderStart.y,
          });
        }
      });
      multiDragRef.current = { leaderId: id, leaderStart, others };
    },
    [selectedIds, onSelectionChange],
  );

  const onItemDragMove = useCallback(
    (leader: Konva.Image) => {
      const md = multiDragRef.current;
      if (!md) return;
      const lx = leader.x();
      const ly = leader.y();
      for (const o of md.others) {
        const n = nodeRefs.current.get(o.id);
        if (n) {
          n.x(lx + o.dx);
          n.y(ly + o.dy);
        }
      }
      leader.getLayer()?.batchDraw();
    },
    [],
  );

  const onItemDragEnd = useCallback(
    (id: string, leader: Konva.Image) => {
      const md = multiDragRef.current;
      multiDragRef.current = null;

      if (!md) {
        // Single-item drag: existing single update.
        onChange(id, { x: leader.x(), y: leader.y() });
        return;
      }
      // Batch: commit leader + all others.
      const updates: Array<{ id: string; patch: Partial<BoardItem> }> = [
        { id, patch: { x: leader.x(), y: leader.y() } },
      ];
      for (const o of md.others) {
        const n = nodeRefs.current.get(o.id);
        if (n) updates.push({ id: o.id, patch: { x: n.x(), y: n.y() } });
      }
      onChangeMany(updates);
    },
    [onChange, onChangeMany],
  );

  // ─── HTML5 drag-and-drop for file/upload intake ───────────────────────────

  async function handleDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);

    const uploadId = e.dataTransfer.getData("application/x-moodboard-upload");
    if (uploadId && getUploadById && onUploadDropped) {
      const upload = getUploadById(uploadId);
      if (upload) {
        const at = pageToBoard(e.clientX, e.clientY);
        if (at) onUploadDropped(upload, at);
        return;
      }
    }

    if (!onFilesDropped) return;
    const all = await extractFilesFromDataTransfer(e.dataTransfer);
    const images = all.filter(f => f.type.startsWith("image/"));
    if (images.length > 0) {
      const at = pageToBoard(e.clientX, e.clientY);
      onFilesDropped(images, at ?? undefined);
    }
  }

  function handleDragOver(e: ReactDragEvent<HTMLDivElement>) {
    const types = Array.from(e.dataTransfer.types);
    const accepts =
      types.includes("Files") ||
      types.includes("application/x-moodboard-upload");
    if (!accepts) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragEnter(e: ReactDragEvent<HTMLDivElement>) {
    const types = Array.from(e.dataTransfer.types);
    const accepts =
      types.includes("Files") ||
      types.includes("application/x-moodboard-upload");
    if (!accepts) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (!dropActive) setDropActive(true);
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  }

  const sorted = [...items].sort((a, b) => a.z - b.z);

  // Container cursor depends on tool / pan mode / marquee in progress.
  const cursorClass = panMode
    ? marqueeStartRef.current
      ? "cursor-grabbing"
      : "cursor-grab"
    : marqueeStartRef.current
    ? "cursor-crosshair"
    : "cursor-default";

  return (
    <div
      ref={containerRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={`relative h-full w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${cursorClass}`}
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={scale}
        scaleY={scale}
        draggable={panMode}
        onDragEnd={e => {
          if (e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
          <Rect x={-4000} y={-4000} width={8000} height={8000} fill="transparent" listening={false} />
          {sorted.map(item => (
            <BoardImage
              key={item.id}
              item={item}
              allItems={items}
              isSelected={selectedIds.has(item.id)}
              snapEnabled={snapEnabled && !multiDragRef.current /* snap only on single drag leader */}
              draggableNode={!panMode}
              onSelect={info => handleImageClick(item.id, info)}
              onDragStart={node => onItemDragStart(item.id, node)}
              onDragMove={node => onItemDragMove(node)}
              onDragEnd={node => onItemDragEnd(item.id, node)}
              onChange={patch => onChange(item.id, patch)}
              registerNode={(node: Konva.Image | null) => {
                if (node) nodeRefs.current.set(item.id, node);
                else nodeRefs.current.delete(item.id);
              }}
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 30 || newBox.height < 30) return oldBox;
              return newBox;
            }}
            anchorStroke="#fff"
            anchorFill="#000"
            borderStroke="#fff"
            borderDash={[4, 4]}
          />
          {marqueeRect && (
            <Rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.w}
              height={marqueeRect.h}
              fill="rgba(99,102,241,0.10)"
              stroke="#6366f1"
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      {dropActive && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-400/70 bg-violet-500/5 text-violet-200 backdrop-blur-[1px]">
          <div className="rounded-lg bg-neutral-900/80 px-4 py-2 text-sm font-medium">
            Drop here to add to canvas
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
});

export default Canvas;

function BoardImage({
  item,
  allItems,
  isSelected,
  snapEnabled,
  draggableNode,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onChange,
  registerNode,
}: {
  item: BoardItem;
  allItems: BoardItem[];
  isSelected: boolean;
  snapEnabled: boolean;
  draggableNode: boolean;
  onSelect: (info: MouseEventInfo) => void;
  onDragStart: (node: Konva.Image) => void;
  onDragMove: (node: Konva.Image) => void;
  onDragEnd: (node: Konva.Image) => void;
  onChange: (patch: Partial<BoardItem>) => void;
  registerNode: (node: Konva.Image | null) => void;
}) {
  const src = proxied(item.image.fullUrl);
  const needsCors = !(src.startsWith("blob:") || src.startsWith("data:"));
  const [img] = useImage(src, needsCors ? "anonymous" : undefined);
  const shapeRef = useRef<Konva.Image>(null);

  // Register / unregister this Konva node so the parent Canvas can coordinate
  // multi-drag and Transformer attach.
  useEffect(() => {
    registerNode(shapeRef.current);
    return () => registerNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSnapDuringDrag(e: Konva.KonvaEventObject<DragEvent>) {
    if (!snapEnabled) return;
    const node = e.target;
    const snapped = snapToNeighbors(
      item.id,
      node.x(),
      node.y(),
      item.width,
      item.height,
      allItems,
    );
    node.x(snapped.x);
    node.y(snapped.y);
  }

  return (
    <KImage
      ref={shapeRef}
      image={img}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      rotation={item.rotation}
      draggable={draggableNode}
      onClick={e => {
        onSelect({
          ctrlOrMeta: e.evt.ctrlKey || e.evt.metaKey,
          shift: e.evt.shiftKey,
        });
      }}
      onTap={e =>
        onSelect({
          ctrlOrMeta: e.evt.ctrlKey || e.evt.metaKey,
          shift: e.evt.shiftKey,
        })
      }
      onDragStart={e => {
        onDragStart(e.target as Konva.Image);
      }}
      onDragMove={e => {
        handleSnapDuringDrag(e);
        onDragMove(e.target as Konva.Image);
      }}
      onDragEnd={e => {
        // Snap leader one more time before commit.
        if (snapEnabled) {
          const node = e.target;
          const snapped = snapToNeighbors(
            item.id,
            node.x(),
            node.y(),
            item.width,
            item.height,
            allItems,
          );
          node.x(snapped.x);
          node.y(snapped.y);
        }
        onDragEnd(e.target as Konva.Image);
      }}
      onTransformEnd={() => {
        const node = shapeRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(30, node.width() * scaleX),
          height: Math.max(30, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
      stroke={isSelected ? "#6366f1" : undefined}
      strokeWidth={isSelected ? 0 : 0}
    />
  );
}
