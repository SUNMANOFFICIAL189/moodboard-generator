"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import SearchPanel from "@/components/SearchPanel";
import RefineModal from "@/components/RefineModal";
import RejectedTray from "@/components/RejectedTray";
import { useBoard } from "@/lib/store";
import {
  useUploadPool,
  uploadToImageResult,
  autoLayoutPositions,
} from "@/lib/upload-pool";
import { clusterLayoutPositions } from "@/lib/cluster-layout";
import { exportZip, exportCanvasPNG } from "@/lib/export";
import type { CanvasHandle, Tool } from "@/components/Canvas";
import type {
  BoardItem,
  ClusterRequestItem,
  ClusterResponse,
  ImageResult,
  UploadedImage,
  VibeCluster,
} from "@/lib/types";
import {
  Download,
  FileImage,
  Trash2,
  Sparkles,
  Magnet,
  Wand2,
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
} from "lucide-react";

const Canvas = dynamic(() => import("@/components/Canvas"), { ssr: false });

// Cost estimate for a single Haiku 4.5 vision call clustering N images.
// Image tokens ~= ceil(w*h / 750). Resized to ≤1568 dim → ~3300 tokens worst-case.
// We resize uploads to 1024 (~1400 tokens). Average ~2000 tokens per image.
// Haiku 4.5 input: $1/M, output: $5/M.
function estimateClusterCost(itemCount: number): string {
  const tokensPerImage = 2000;
  const systemTokens = 700;
  const outputTokens = 600;
  const inputUsd = ((itemCount * tokensPerImage + systemTokens) / 1_000_000) * 1.0;
  const outputUsd = (outputTokens / 1_000_000) * 5.0;
  const total = inputUsd + outputUsd;

  if (total < 0.01) return "less than a penny";
  if (total < 1) return `about ${Math.round(total * 100)} cents`;
  return `about $${total.toFixed(2)}`;
}

type RefineStage = "cost" | "loading" | "result" | "error";

async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : "");
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

async function prepareClusterPayload(
  items: BoardItem[],
): Promise<{ payload: ClusterRequestItem[]; skipped: number }> {
  const results = await Promise.all(
    items.map(async (it): Promise<ClusterRequestItem | null> => {
      if (it.image.provider === "upload") {
        try {
          const base64 = await blobUrlToBase64(it.image.fullUrl);
          return { id: it.id, base64, mediaType: "image/jpeg" };
        } catch {
          // Blob URL is dead (revoked or never valid). Skip silently rather
          // than failing the entire batch.
          return null;
        }
      }
      return { id: it.id, url: it.image.thumbUrl };
    }),
  );
  const payload = results.filter((x): x is ClusterRequestItem => x !== null);
  return { payload, skipped: results.length - payload.length };
}

export default function Home() {
  const {
    items,
    rejected,
    hydrated,
    addImage,
    addImagesAt,
    updateItem,
    updateItems,
    removeItem,
    removeItems,
    bringToFront,
    clear,
    restoreFromRejected,
    clearRejected,
    applyRefineResult,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useBoard();
  const uploadPool = useUploadPool();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  // Refine modal state
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineStage, setRefineStage] = useState<RefineStage>("cost");
  const [clusters, setClusters] = useState<VibeCluster[]>([]);
  const [refineError, setRefineError] = useState<string | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), uploadPool.toastMs);
    },
    [uploadPool.toastMs],
  );

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
  }

  // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "z") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (redo()) showToast("Redone");
      } else {
        if (undo()) showToast("Undone");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, showToast]);

  // V = Select tool, H = Pan tool, Space (hold) = transient pan.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "v") {
        e.preventDefault();
        setTool("select");
      } else if (key === "h") {
        e.preventDefault();
        setTool("pan");
      } else if (e.code === "Space") {
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    }
    function onBlur() {
      // Window blur can swallow keyup — release space defensively.
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Mode A: drop files directly on canvas → add to pool + auto-layout onto board.
  const handleCanvasFilesDropped = useCallback(
    async (files: File[], dropAtViewport?: { x: number; y: number }) => {
      if (files.length === 0) return;
      const result = await uploadPool.addFiles(files);
      if (result.added.length > 0) {
        const positions = autoLayoutPositions(result.added, {
          startX: dropAtViewport?.x ?? 160,
          startY: dropAtViewport?.y ?? 160,
          gap: 10,
        });
        addImagesAt(
          result.added.map((u, i) => ({
            image: uploadToImageResult(u),
            x: positions[i].x,
            y: positions[i].y,
            width: positions[i].width,
            height: positions[i].height,
          })),
        );
        // Drop targets are already in the viewport (drop event has clientX/Y),
        // but if a deferred user-initiated drop landed off-screen we still
        // recentre to be safe.
        canvasRef.current?.focusOn(positions[0].x, positions[0].y);
        showToast(
          `Added ${result.added.length} ${result.added.length === 1 ? "image" : "images"} to canvas` +
            (result.skipped.length > 0 ? ` · skipped ${result.skipped.length}` : ""),
        );
      } else if (result.skipped.length > 0) {
        showToast(`Skipped ${result.skipped.length}: ${result.skipped[0].reason}`);
      }
    },
    [uploadPool, addImagesAt, showToast],
  );

  // Batch-place: "Add all to canvas" from the My uploads tab or any results session.
  // Starts below any existing items so nothing overlaps, then auto-pans the
  // viewport to the new placement so the user actually sees what just landed.
  const handleSendAllToCanvas = useCallback(
    (imgs: ImageResult[]) => {
      if (imgs.length === 0) return;
      const startY =
        items.length > 0
          ? Math.max(...items.map(it => it.y + it.height)) + 20
          : 160;
      const positions = autoLayoutPositions(imgs, {
        startX: 160,
        startY,
        gap: 10,
      });
      addImagesAt(
        imgs.map((image, i) => ({
          image,
          x: positions[i].x,
          y: positions[i].y,
          width: positions[i].width,
          height: positions[i].height,
        })),
      );
      canvasRef.current?.focusOn(positions[0].x, positions[0].y);
      showToast(`Added ${imgs.length} ${imgs.length === 1 ? "image" : "images"} to canvas`);
    },
    [items, addImagesAt, showToast],
  );

  // Drag an upload thumbnail from panel onto canvas → place at drop point.
  const handleCanvasUploadDropped = useCallback(
    (upload: UploadedImage, dropAtViewport: { x: number; y: number }) => {
      const positions = autoLayoutPositions([upload], {
        startX: dropAtViewport.x,
        startY: dropAtViewport.y,
        targetWidth: 260,
        gap: 10,
      });
      addImagesAt([
        {
          image: uploadToImageResult(upload),
          x: positions[0].x,
          y: positions[0].y,
          width: positions[0].width,
          height: positions[0].height,
        },
      ]);
    },
    [addImagesAt],
  );

  function handleExportPNG() {
    const url = canvasRef.current?.exportPNG();
    if (url) exportCanvasPNG(url);
  }

  function handleDelete() {
    if (selectedIds.size === 0) return;
    removeItems(Array.from(selectedIds));
    setSelectedIds(new Set());
  }

  function openRefine() {
    setClusters([]);
    setRefineError(null);
    setRefineStage("cost");
    setRefineOpen(true);
  }

  function closeRefine() {
    if (refineStage === "loading") return;
    setRefineOpen(false);
  }

  async function confirmCostAndRun() {
    setRefineStage("loading");
    setRefineError(null);
    try {
      const { payload, skipped } = await prepareClusterPayload(items);
      if (payload.length < 2) {
        throw new Error(
          skipped > 0
            ? `Couldn't read ${skipped} uploaded images (they may have been cleared from the My uploads tab). Re-upload and try again.`
            : "Need at least 2 images to cluster.",
        );
      }
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Cluster failed (${res.status})`);
      }
      const data = (await res.json()) as ClusterResponse;
      if (!data.clusters || data.clusters.length === 0) {
        throw new Error("Haiku returned no clusters — try again");
      }
      setClusters(data.clusters);
      if (skipped > 0) {
        showToast(`Skipped ${skipped} unreadable uploads`);
      }
      setRefineStage("result");
    } catch (err) {
      let msg = err instanceof Error ? err.message : "Cluster failed";
      if (msg === "Failed to fetch") {
        msg =
          "Couldn't reach the cluster service — the request may be too large or a network hiccup. Try fewer images or check the dev server.";
      }
      setRefineError(msg);
      setRefineStage("error");
    }
  }

  function confirmCluster(keepClusterIds: string[]) {
    const keepSet = new Set(keepClusterIds);
    const keptClusters = clusters.filter(c => keepSet.has(c.id));
    const toReject: string[] = [];
    for (const c of clusters) {
      if (!keepSet.has(c.id)) toReject.push(...c.itemIds);
    }

    const itemsById = new Map(items.map(it => [it.id, it]));
    const positions = clusterLayoutPositions(keptClusters, itemsById, {
      startX: 160,
      startY: 160,
      targetWidth: 240,
      intraGap: 10,
      interGap: 80,
    });

    applyRefineResult(toReject, positions);

    // Pan to the cluster layout origin so the user sees the new arrangement
    // even if they were panned away from (160, 160) before clicking Refine.
    if (Object.keys(positions).length > 0) {
      canvasRef.current?.focusOn(160, 160);
    }

    const kept = keptClusters.reduce((n, c) => n + c.itemIds.length, 0);
    const parts: string[] = [];
    if (kept > 0) parts.push(`Clustered ${kept}`);
    if (toReject.length > 0) parts.push(`moved ${toReject.length} to Rejected`);
    if (parts.length > 0) showToast(parts.join(" · "));

    setRefineOpen(false);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-[340px] shrink-0 border-r border-neutral-800">
        <SearchPanel
          onAdd={addImage}
          uploadPool={uploadPool}
          onUploadAddToCanvas={upload =>
            handleCanvasUploadDropped(upload, { x: 160, y: 160 })
          }
          onSendAllToCanvas={handleSendAllToCanvas}
        />
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-neutral-400" />
            <h1 className="text-sm font-semibold tracking-tight">Moodboard Generator</h1>
            <span className="ml-2 text-xs text-neutral-500">
              {items.length} {items.length === 1 ? "image" : "images"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5">
              <button
                onClick={() => setTool("select")}
                className={`flex items-center gap-1 rounded p-1 transition ${
                  tool === "select" && !spaceHeld
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
                title="Select tool (V) — drag to lasso, Cmd-click to add"
              >
                <MousePointer2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTool("pan")}
                className={`flex items-center gap-1 rounded p-1 transition ${
                  tool === "pan" || spaceHeld
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
                title="Pan tool (H, or hold Space) — drag to pan the canvas"
              >
                <Hand className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mx-1 h-5 w-px bg-neutral-800" />
            <button
              onClick={openRefine}
              disabled={items.length < 2}
              className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 transition hover:border-violet-400/60 hover:bg-violet-500/15 hover:text-violet-200 disabled:opacity-30"
              title={
                items.length < 2
                  ? "Need at least 2 images on the board to refine"
                  : "Cluster the board into vibe groups, keep what fits"
              }
            >
              <Wand2 className="h-3.5 w-3.5" /> Refine vibe
            </button>
            <div className="mx-1 h-5 w-px bg-neutral-800" />
            <button
              onClick={() => {
                if (undo()) showToast("Undone");
              }}
              disabled={!canUndo}
              className="rounded-md border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
              title="Undo (⌘Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (redo()) showToast("Redone");
              }}
              disabled={!canRedo}
              className="rounded-md border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
              title="Redo (⇧⌘Z)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <div className="mx-1 h-5 w-px bg-neutral-800" />
            <button
              onClick={() => setSnapEnabled(s => !s)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition ${
                snapEnabled
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                  : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300"
              }`}
              title={snapEnabled ? "Snap on (10px gap)" : "Snap off"}
            >
              <Magnet className="h-3.5 w-3.5" /> Snap
            </button>
            <div className="mx-1 h-5 w-px bg-neutral-800" />
            <button
              onClick={handleDelete}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
              title={
                selectedIds.size === 0
                  ? "Select images first (click or lasso)"
                  : `Delete ${selectedIds.size} selected (Backspace)`
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ""}
            </button>
            <button
              onClick={() => {
                if (confirm("Clear the whole board?")) {
                  clear();
                  setSelectedIds(new Set());
                }
              }}
              disabled={items.length === 0}
              className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
            >
              Clear
            </button>
            <div className="mx-1 h-5 w-px bg-neutral-800" />
            <button
              onClick={handleExportPNG}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
            >
              <FileImage className="h-3.5 w-3.5" /> PNG
            </button>
            <button
              onClick={() => exportZip(items)}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-30"
            >
              <Download className="h-3.5 w-3.5" /> ZIP
            </button>
          </div>
        </header>

        <div className="relative flex-1">
          {hydrated && items.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900">
                  <Sparkles className="h-5 w-5 text-neutral-500" />
                </div>
                <p className="text-sm text-neutral-500">
                  Search, drag images from My uploads, or drop a folder on the canvas
                </p>
                <p className="mt-1 text-xs text-neutral-600">Drag · resize · rotate · scroll to zoom</p>
              </div>
            </div>
          )}
          <Canvas
            ref={canvasRef}
            items={items}
            selectedIds={selectedIds}
            tool={tool}
            spaceHeld={spaceHeld}
            snapEnabled={snapEnabled}
            onSelectionChange={setSelectedIds}
            onChange={updateItem}
            onChangeMany={updateItems}
            onBringToFront={bringToFront}
            onDelete={removeItem}
            onFilesDropped={handleCanvasFilesDropped}
            getUploadById={id => uploadPool.uploads.find(u => u.id === id) ?? null}
            onUploadDropped={handleCanvasUploadDropped}
          />

          {toast && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-100 shadow-lg">
              {toast}
            </div>
          )}

          <RejectedTray
            rejected={rejected}
            onRestore={restoreFromRejected}
            onClearAll={clearRejected}
          />
        </div>
      </main>

      <RefineModal
        open={refineOpen}
        stage={refineStage}
        itemCount={items.length}
        estimatedCost={estimateClusterCost(items.length)}
        clusters={clusters}
        items={items}
        errorMessage={refineError}
        onConfirmCost={confirmCostAndRun}
        onConfirmKeep={confirmCluster}
        onClose={closeRefine}
      />
    </div>
  );
}
