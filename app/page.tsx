"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import SearchPanel from "@/components/SearchPanel";
import { useBoard } from "@/lib/store";
import { exportZip, exportCanvasPNG } from "@/lib/export";
import type { CanvasHandle } from "@/components/Canvas";
import { Download, FileImage, Trash2, Sparkles, Magnet } from "lucide-react";

const Canvas = dynamic(() => import("@/components/Canvas"), { ssr: false });

export default function Home() {
  const { items, hydrated, addImage, updateItem, removeItem, bringToFront, clear } = useBoard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const canvasRef = useRef<CanvasHandle>(null);

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
        <SearchPanel onAdd={addImage} />
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
                <p className="text-sm text-neutral-500">Search for images, then click Add</p>
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
          />
        </div>
      </main>
    </div>
  );
}
