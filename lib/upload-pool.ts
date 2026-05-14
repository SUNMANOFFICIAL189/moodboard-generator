"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageResult, UploadedImage } from "./types";
import { uid } from "./utils";

// In-memory pool (Option A — session only). Survives navigation within the
// SPA but not page refresh. IndexedDB upgrade tracked in BACKLOG 2026-05-14.

const SOFT_CAP = 50;
const HARD_CAP = 100;
const MAX_BYTES = 25 * 1024 * 1024; // per-file
const MAX_DIM = 1024;
const PER_BATCH_TOAST_MS = 4500;

export interface AddFilesResult {
  added: UploadedImage[];
  skipped: { filename: string; reason: string }[];
}

export function useUploadPool() {
  const [uploads, setUploads] = useState<UploadedImage[]>([]);

  // Always read the live list inside callbacks to avoid stale closures.
  const ref = useRef<UploadedImage[]>([]);
  useEffect(() => {
    ref.current = uploads;
  }, [uploads]);

  // Revoke all blob URLs on unmount.
  useEffect(() => {
    return () => {
      for (const u of ref.current) URL.revokeObjectURL(u.blobUrl);
    };
  }, []);

  const addFiles = useCallback(async (files: File[]): Promise<AddFilesResult> => {
    const skipped: { filename: string; reason: string }[] = [];
    const room = HARD_CAP - ref.current.length;
    if (room <= 0) {
      return {
        added: [],
        skipped: files.map(f => ({ filename: f.name, reason: "pool is full" })),
      };
    }

    const accepted: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        skipped.push({ filename: f.name, reason: "not an image" });
        continue;
      }
      if (f.size > MAX_BYTES) {
        skipped.push({
          filename: f.name,
          reason: `${(f.size / 1024 / 1024).toFixed(1)}MB exceeds 25MB cap`,
        });
        continue;
      }
      accepted.push(f);
      if (accepted.length >= room) break;
    }
    if (accepted.length < files.filter(f => f.type.startsWith("image/")).length) {
      const overflow = files.length - accepted.length - skipped.length;
      if (overflow > 0) {
        skipped.push({
          filename: `(${overflow} more)`,
          reason: `pool cap is ${HARD_CAP}`,
        });
      }
    }

    const added: UploadedImage[] = [];
    for (const f of accepted) {
      try {
        const u = await fileToUpload(f);
        added.push(u);
      } catch (err) {
        skipped.push({
          filename: f.name,
          reason: err instanceof Error ? err.message : "decode failed",
        });
      }
    }

    if (added.length > 0) {
      setUploads(prev => [...prev, ...added]);
    }

    return { added, skipped };
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads(prev => {
      const target = prev.find(u => u.id === id);
      if (target) URL.revokeObjectURL(target.blobUrl);
      return prev.filter(u => u.id !== id);
    });
  }, []);

  const clearUploads = useCallback(() => {
    setUploads(prev => {
      for (const u of prev) URL.revokeObjectURL(u.blobUrl);
      return [];
    });
  }, []);

  return {
    uploads,
    addFiles,
    removeUpload,
    clearUploads,
    softCap: SOFT_CAP,
    hardCap: HARD_CAP,
    toastMs: PER_BATCH_TOAST_MS,
  };
}

// ─── Conversions ─────────────────────────────────────────────────────────────

export function uploadToImageResult(u: UploadedImage): ImageResult {
  return {
    id: u.id,
    provider: "upload",
    thumbUrl: u.blobUrl,
    fullUrl: u.blobUrl,
    width: u.width,
    height: u.height,
    author: "You",
    sourceUrl: "",
    alt: u.filename,
  };
}

// ─── File extraction (incl. folder drop via webkit entry API) ────────────────

export async function extractFilesFromDataTransfer(
  dt: DataTransfer,
): Promise<File[]> {
  const out: File[] = [];

  // Prefer the items API so we can recurse into folders.
  if (dt.items && dt.items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const entry = (item as unknown as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
      }).webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      } else {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    for (const entry of entries) {
      await collectEntry(entry, out);
    }
    return out;
  }

  // Fallback: flat file list (no folder support).
  if (dt.files) {
    for (const f of Array.from(dt.files)) out.push(f);
  }
  return out;
}

async function collectEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[] = [];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const e of batch) await collectEntry(e, out);
    } while (batch.length > 0);
  }
}

// ─── Resize + blob URL ───────────────────────────────────────────────────────

async function fileToUpload(file: File): Promise<UploadedImage> {
  const tempUrl = URL.createObjectURL(file);
  let bitmap: HTMLImageElement;
  try {
    bitmap = await loadImage(tempUrl);
  } finally {
    URL.revokeObjectURL(tempUrl);
  }

  const ratio = Math.min(
    1,
    MAX_DIM / Math.max(bitmap.naturalWidth, bitmap.naturalHeight),
  );
  const w = Math.max(1, Math.round(bitmap.naturalWidth * ratio));
  const h = Math.max(1, Math.round(bitmap.naturalHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new Error("encode failed");

  const blobUrl = URL.createObjectURL(blob);

  return {
    id: uid(),
    blobUrl,
    width: w,
    height: h,
    filename: file.name,
    mime: blob.type,
    bytes: blob.size,
    addedAt: Date.now(),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

// ─── Auto-layout for Mode A (drop on canvas) ─────────────────────────────────

export interface AutoLayoutOptions {
  startX: number;
  startY: number;
  targetWidth?: number;
  gap?: number;
  columns?: number;
}

export interface AutoLayoutPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function autoLayoutPositions(
  sizes: Array<{ width: number; height: number }>,
  opts: AutoLayoutOptions,
): AutoLayoutPosition[] {
  const targetWidth = opts.targetWidth ?? 200;
  const gap = opts.gap ?? 10;
  const columns = opts.columns ?? Math.max(1, Math.ceil(Math.sqrt(sizes.length)));

  const positions: AutoLayoutPosition[] = [];
  let col = 0;
  let y = opts.startY;
  let rowMaxHeight = 0;

  for (const size of sizes) {
    const aspect = size.width / size.height || 1;
    const w = targetWidth;
    const h = Math.round(w / aspect);
    const x = opts.startX + col * (targetWidth + gap);
    positions.push({ x, y, width: w, height: h });
    rowMaxHeight = Math.max(rowMaxHeight, h);
    col++;
    if (col >= columns) {
      col = 0;
      y += rowMaxHeight + gap;
      rowMaxHeight = 0;
    }
  }
  return positions;
}
