"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Stage, Layer, Image as KImage, Transformer, Rect } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { BoardItem } from "@/lib/types";
import { proxied } from "@/lib/utils";

const GAP = 10;

export interface CanvasHandle {
  exportPNG: () => string | null;
}

interface Props {
  items: BoardItem[];
  selectedId: string | null;
  snapEnabled: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<BoardItem>) => void;
  onBringToFront: (id: string) => void;
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

    // X-axis: snap edges with GAP
    const xSnaps = [
      { drag: dragEdges.right, target: o.left - GAP, offset: 0 },    // right edge → left of other, with gap
      { drag: dragEdges.left, target: o.right + GAP, offset: 0 },    // left edge → right of other, with gap
      { drag: dragEdges.left, target: o.left, offset: 0 },           // left → left align
      { drag: dragEdges.right, target: o.right, offset: 0 },         // right → right align
      { drag: dragEdges.cx, target: o.cx, offset: 0 },               // center → center align
    ];

    for (const s of xSnaps) {
      const d = Math.abs(s.drag - s.target);
      if (d < dxMin) {
        dxMin = d;
        snappedX = s.target - (s.drag - x) + s.offset;
      }
    }

    // Y-axis: snap edges with GAP
    const ySnaps = [
      { drag: dragEdges.bottom, target: o.top - GAP, offset: 0 },    // bottom → top of other, with gap
      { drag: dragEdges.top, target: o.bottom + GAP, offset: 0 },    // top → bottom of other, with gap
      { drag: dragEdges.top, target: o.top, offset: 0 },             // top → top align
      { drag: dragEdges.bottom, target: o.bottom, offset: 0 },       // bottom → bottom align
      { drag: dragEdges.cy, target: o.cy, offset: 0 },               // center → center align
    ];

    for (const s of ySnaps) {
      const d = Math.abs(s.drag - s.target);
      if (d < dyMin) {
        dyMin = d;
        snappedY = s.target - (s.drag - y) + s.offset;
      }
    }
  }

  return { x: snappedX, y: snappedY };
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { items, selectedId, snapEnabled, onSelect, onChange, onBringToFront },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const stage = stageRef.current;
      if (!stage) return null;
      return stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
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

  const sorted = [...items].sort((a, b) => a.z - b.z);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900"
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
        draggable
        onDragEnd={e => {
          if (e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onWheel={handleWheel}
        onMouseDown={e => {
          if (e.target === e.target.getStage()) onSelect(null);
        }}
      >
        <Layer>
          <Rect x={-4000} y={-4000} width={8000} height={8000} fill="transparent" listening={false} />
          {sorted.map(item => (
            <BoardImage
              key={item.id}
              item={item}
              allItems={items}
              isSelected={item.id === selectedId}
              snapEnabled={snapEnabled}
              onSelect={() => {
                onSelect(item.id);
                onBringToFront(item.id);
              }}
              onChange={patch => onChange(item.id, patch)}
            />
          ))}
        </Layer>
      </Stage>

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
  onSelect,
  onChange,
}: {
  item: BoardItem;
  allItems: BoardItem[];
  isSelected: boolean;
  snapEnabled: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<BoardItem>) => void;
}) {
  const [img] = useImage(proxied(item.image.fullUrl), "anonymous");
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  function handleDragMove(e: Konva.KonvaEventObject<DragEvent>) {
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

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    let x = node.x();
    let y = node.y();
    if (snapEnabled) {
      const snapped = snapToNeighbors(item.id, x, y, item.width, item.height, allItems);
      x = snapped.x;
      y = snapped.y;
    }
    onChange({ x, y });
  }

  return (
    <>
      <KImage
        ref={shapeRef}
        image={img}
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        rotation={item.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
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
        shadowColor="black"
        shadowBlur={isSelected ? 20 : 10}
        shadowOpacity={isSelected ? 0.4 : 0.15}
        shadowOffset={{ x: 0, y: 4 }}
      />
      {isSelected && (
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
      )}
    </>
  );
}
