"use client";

import JSZip from "jszip";
import type { BoardItem } from "./types";
import { proxied } from "./utils";

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportZip(items: BoardItem[]) {
  if (items.length === 0) return;
  const zip = new JSZip();
  const folder = zip.folder("moodboard")!;
  const credits: string[] = ["# Moodboard — image credits\n"];

  await Promise.all(
    items.map(async (item, i) => {
      try {
        const res = await fetch(proxied(item.image.fullUrl));
        if (!res.ok) return;
        const blob = await res.blob();
        const ext = extFromMime(blob.type);
        const name = `${String(i + 1).padStart(2, "0")}-${item.image.provider}-${item.image.id.replace(/[^a-z0-9-]/gi, "")}.${ext}`;
        folder.file(name, blob);
        credits.push(
          `- ${name} — ${item.image.author} (${item.image.provider}) — ${item.image.sourceUrl}`,
        );
      } catch {
        /* skip */
      }
    }),
  );

  folder.file("CREDITS.md", credits.join("\n"));
  const content = await zip.generateAsync({ type: "blob" });
  triggerDownload(content, `moodboard-${Date.now()}.zip`);
}

export function exportCanvasPNG(dataUrl: string) {
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  triggerDownload(new Blob([arr], { type: "image/png" }), `moodboard-${Date.now()}.png`);
}
