"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardItem, VibeCluster } from "@/lib/types";
import { cn, proxied } from "@/lib/utils";
import { Sparkles, X, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  stage: "cost" | "loading" | "result" | "error";
  itemCount: number;
  estimatedCost: string;
  clusters: VibeCluster[];
  items: BoardItem[];
  errorMessage: string | null;
  onConfirmCost: () => void;
  onConfirmKeep: (keepClusterIds: string[]) => void;
  onClose: () => void;
}

export default function RefineModal({
  open,
  stage,
  itemCount,
  estimatedCost,
  clusters,
  items,
  errorMessage,
  onConfirmCost,
  onConfirmKeep,
  onClose,
}: Props) {
  // Each cluster has a keep/discard toggle. Default: all kept.
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (stage === "result") {
      const init: Record<string, boolean> = {};
      for (const c of clusters) init[c.id] = true;
      setKeep(init);
    }
  }, [stage, clusters]);

  const itemById = useMemo(() => {
    const map = new Map<string, BoardItem>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  if (!open) return null;

  const discardCount = clusters
    .filter(c => !keep[c.id])
    .reduce((sum, c) => sum + c.itemIds.length, 0);
  const keepCount = clusters
    .filter(c => keep[c.id])
    .reduce((sum, c) => sum + c.itemIds.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={e => {
        // Close on backdrop click; ignore clicks bubbling from inside.
        if (e.target === e.currentTarget && stage !== "loading") onClose();
      }}
    >
      <div
        className="relative max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold tracking-tight">Refine board vibe</h2>
          </div>
          <button
            onClick={onClose}
            disabled={stage === "loading"}
            className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-30"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {stage === "cost" && (
          <div className="p-6">
            <p className="mb-2 text-sm text-neutral-200">
              I&apos;ll look at all <strong>{itemCount}</strong> images on your board and group them
              into 2 or 3 vibe clusters. You then choose which clusters to keep — the rest move to a
              recoverable Rejected tray.
            </p>
            <p className="mb-6 text-sm text-neutral-400">
              Estimated cost: <strong className="text-neutral-200">{estimatedCost}</strong> (one
              Haiku 4.5 vision call). Nothing on your board moves until you confirm in the next
              step.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmCost}
                className="flex items-center gap-1.5 rounded-md bg-violet-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Cluster {itemCount} images
              </button>
            </div>
          </div>
        )}

        {stage === "loading" && (
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-neutral-300">
            <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
            <p className="text-sm">Haiku is reading your board…</p>
            <p className="text-[11px] text-neutral-500">
              This usually takes 10-30 seconds depending on the image count.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="p-6">
            <p className="mb-4 text-sm text-red-300">
              {errorMessage ?? "Something went wrong while clustering. No changes were made to your board."}
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {stage === "result" && (
          <>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              <p className="mb-4 text-xs text-neutral-400">
                Haiku found <strong className="text-neutral-200">{clusters.length}</strong> vibe
                group{clusters.length === 1 ? "" : "s"} in your board. Toggle each one to keep or
                discard.
              </p>

              <div className="flex flex-col gap-3">
                {clusters.map(c => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    items={c.itemIds
                      .map(id => itemById.get(id))
                      .filter((x): x is BoardItem => !!x)}
                    kept={keep[c.id] ?? true}
                    onToggle={() =>
                      setKeep(prev => ({ ...prev, [c.id]: !(prev[c.id] ?? true) }))
                    }
                  />
                ))}
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950 px-5 py-3">
              <p className="text-[11px] text-neutral-500">
                Rearrange <strong className="text-neutral-200">{keepCount}</strong> on canvas
                {discardCount > 0 && (
                  <>
                    {" "}
                    · Move <strong className="text-neutral-200">{discardCount}</strong> to Rejected
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    onConfirmKeep(clusters.filter(c => keep[c.id] ?? true).map(c => c.id))
                  }
                  disabled={keepCount === 0}
                  className="flex items-center gap-1.5 rounded-md bg-violet-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-400 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Cluster on canvas
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function ClusterCard({
  cluster,
  items,
  kept,
  onToggle,
}: {
  cluster: VibeCluster;
  items: BoardItem[];
  kept: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition",
        kept
          ? "border-violet-500/40 bg-violet-500/5"
          : "border-neutral-800 bg-neutral-900/40 opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold transition",
            kept
              ? "border-violet-400 bg-violet-500 text-white"
              : "border-neutral-700 bg-neutral-900 text-neutral-600",
          )}
          title={kept ? "Click to discard this group" : "Click to keep this group"}
        >
          {kept ? "✓" : ""}
        </button>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold capitalize text-neutral-100">
              {cluster.label}
            </h3>
            <span className="text-[10px] text-neutral-500">
              {cluster.itemIds.length} image{cluster.itemIds.length === 1 ? "" : "s"}
            </span>
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                kept
                  ? "bg-violet-500/20 text-violet-200"
                  : "bg-neutral-800 text-neutral-500",
              )}
            >
              {kept ? "Keep" : "Discard"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">{cluster.summary}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {items.slice(0, 12).map(it => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={it.id}
                src={proxied(it.image.thumbUrl)}
                alt={it.image.alt ?? ""}
                className="h-12 w-16 rounded border border-neutral-800 object-cover"
                draggable={false}
              />
            ))}
            {items.length > 12 && (
              <div className="flex h-12 w-16 items-center justify-center rounded border border-neutral-800 bg-neutral-900 text-[10px] text-neutral-400">
                +{items.length - 12}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
