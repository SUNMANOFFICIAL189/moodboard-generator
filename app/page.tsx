"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import SearchPanel from "@/components/SearchPanel";
import { useBoard } from "@/lib/store";
import {
  useUploadPool,
  uploadToImageResult,
  autoLayoutPositions,
} from "@/lib/upload-pool";
import { exportZip, exportCanvasPNG } from "@/lib/export";
import type { CanvasHandle } from "@/components/Canvas";
import type { UploadedImage } from "@/lib/types";
import { Download, FileImage, Trash2, Sparkles, Magnet } from "lucide-react";

const Canvas = dynamic(() => import("@/components/Canvas"), { ssr: false });

export default function Home() {
  const { items, hydrated, addImage, addImagesAt, updateItem, removeItem, bringToFront, clear } =
    useBoard();
  const uploadPool = useUploadPool();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      window.setTimeout(() => setToast(null), uploadPool.toastMs);
    },
    [uploadPool.toastMs],
  );

  // Mode A: drop files directly on canvas → add to pool + auto-layout onto board.
  const handleCanvasFilesDropped = useCallback(
    async (files: File[], dropAtViewport?: { x: number; y: number }) => {
      if (files.length === 0) return;
      const result = await uploadPool.addFiles(files);
      if (result.added.length > 0) {
        const positions = autoLayoutPositions(result.added, {
          startX: dropAtViewport?.x ?? 160,
          startY: dropAtViewport?.y ?? 160,
          targetWidth: 200,
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
    if (selectedId) {
      removeItem(selectedId);
      setSelectedId(null);
    }
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
              disabled={!selectedId}
              className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button
              onClick={() => {
                if (confirm("Clear the whole board?")) {
                  clear();
                  setSelectedId(null);
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
            selectedId={selectedId}
            snapEnabled={snapEnabled}
            onSelect={setSelectedId}
            onChange={updateItem}
            onBringToFront={bringToFront}
            onDelete={removeItem}
            onFilesDropped={handleCanvasFilesDropped}
            getUploadById={id => uploadPool.uploads.find(u => u.id === id) ?? null}
            onUploadDropped={handleCanvasUploadDropped}
          />

          {toast && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-100 shadow-lg">
              {toast}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
