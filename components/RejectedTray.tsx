"use client";

import { useState } from "react";
import type { BoardItem } from "@/lib/types";
import { proxied } from "@/lib/utils";
import { Archive, ChevronUp, ChevronDown, RotateCcw, Trash2 } from "lucide-react";

interface Props {
  rejected: BoardItem[];
  onRestore: (id: string) => void;
  onClearAll: () => void;
}

export default function RejectedTray({ rejected, onRestore, onClearAll }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (rejected.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-20 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-sm">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-neutral-300 transition hover:bg-neutral-900"
      >
        <Archive className="h-3.5 w-3.5 text-neutral-500" />
        <span>
          Rejected · <strong className="text-neutral-100">{rejected.length}</strong>
        </span>
        <span className="text-[10px] text-neutral-500">
          {expanded ? "Click to collapse" : "Click to expand"}
        </span>
        {expanded ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-neutral-500" />
        ) : (
          <ChevronUp className="ml-auto h-3.5 w-3.5 text-neutral-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-neutral-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] text-neutral-500">
              Hover a thumbnail and click the arrow to restore. Clear deletes everything here.
            </p>
            <button
              onClick={() => {
                if (confirm(`Permanently delete ${rejected.length} rejected images from this session?`)) {
                  onClearAll();
                }
              }}
              className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-400 transition hover:border-red-500/50 hover:text-red-300"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
            {rejected.map(item => (
              <RejectedThumb
                key={item.id}
                item={item}
                onRestore={() => onRestore(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RejectedThumb({
  item,
  onRestore,
}: {
  item: BoardItem;
  onRestore: () => void;
}) {
  return (
    <div
      className="group relative h-16 w-20 shrink-0 overflow-hidden rounded border border-neutral-800 bg-neutral-900"
      title={item.image.alt ?? item.image.author}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={proxied(item.image.thumbUrl)}
        alt={item.image.alt ?? ""}
        className="h-full w-full object-cover opacity-50 transition group-hover:opacity-100"
        draggable={false}
      />
      <button
        onClick={onRestore}
        className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
        title="Restore to board"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );
}
