"use client";

import { useState, useRef, FormEvent, ChangeEvent, DragEvent, ClipboardEvent } from "react";
import type {
  ImageResult,
  Provider,
  ReferenceImage,
  ResultSet,
  SimilarSearchInput,
  SimilarSearchResponse,
  UploadedImage,
  VibeSummary,
} from "@/lib/types";
import { cn, proxied, uid } from "@/lib/utils";
import {
  extractFilesFromDataTransfer,
  uploadToImageResult,
  type useUploadPool,
} from "@/lib/upload-pool";
import {
  Search,
  Plus,
  Loader2,
  ExternalLink,
  X,
  Sparkles,
  Upload,
  Link2,
  FolderOpen,
  Images,
  Trash2,
} from "lucide-react";

// User-facing search providers (uploads handled separately, not toggleable).
const ALL: Provider[] = ["unsplash", "pexels", "pixabay", "pinterest", "arena", "cosmos"];
const MAX_REFS = 3;
const MAX_SESSIONS = 5;
const MAX_UPLOAD_DIM = 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOADS_TAB_ID = "__uploads__";

type UploadPool = ReturnType<typeof useUploadPool>;

interface Props {
  onAdd: (img: ImageResult) => void;
  uploadPool: UploadPool;
  onUploadAddToCanvas: (upload: UploadedImage) => void;
  onSendAllToCanvas: (imgs: ImageResult[]) => void;
}

export default function SearchPanel({
  onAdd,
  uploadPool,
  onUploadAddToCanvas,
  onSendAllToCanvas,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [vibeLoading, setVibeLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([...ALL]);
  const [error, setError] = useState<string | null>(null);
  const [missingKeys, setMissingKeys] = useState<Record<Provider, boolean> | null>(null);

  const [sessions, setSessions] = useState<ResultSet[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [uploadIntakeLoading, setUploadIntakeLoading] = useState(false);
  const [uploadsDragOver, setUploadsDragOver] = useState(false);
  const [uploadFindSimilarId, setUploadFindSimilarId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const uploadsTabActive = activeSessionId === UPLOADS_TAB_ID;
  const activeSession = uploadsTabActive
    ? null
    : sessions.find(s => s.id === activeSessionId) ?? null;

  function addSession(session: ResultSet) {
    setSessions(prev => {
      const next = [session, ...prev].slice(0, MAX_SESSIONS);
      return next;
    });
    setActiveSessionId(session.id);
  }

  function removeSession(id: string) {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (id === activeSessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function toggleProvider(p: Provider) {
    setProviders(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]));
  }

  async function handleKeywordSearch(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || keywordLoading) return;
    setKeywordLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, providers }),
      });
      if (!res.ok) {
        setError("Search failed");
      } else {
        const data = await res.json();
        setMissingKeys(data.missingKeys ?? null);
        const session: ResultSet = {
          id: uid(),
          kind: "keyword",
          label: truncate(prompt.trim(), 24),
          createdAt: Date.now(),
          queries: data.queries ?? [],
          results: data.results ?? [],
        };
        addSession(session);
      }
    } catch {
      setError("Network error");
    } finally {
      setKeywordLoading(false);
    }
  }

  async function handleVibeSearch() {
    if (references.length === 0 || vibeLoading) return;
    setVibeLoading(true);
    setError(null);
    try {
      const inputs: SimilarSearchInput[] = references.map(ref => {
        if (ref.kind === "upload") {
          const [meta, data] = ref.source.split(",", 2);
          const mediaType = meta.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
          return { base64: data ?? ref.source, mediaType };
        }
        return { url: ref.source };
      });
      const res = await fetch("/api/similar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: inputs, providers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Vibe search failed");
      } else {
        const data: SimilarSearchResponse = await res.json();
        const session: ResultSet = {
          id: uid(),
          kind: "vibe",
          label: vibeLabel(data.vibe),
          createdAt: Date.now(),
          queries: data.vibe.queries,
          vibe: data.vibe,
          results: data.results,
        };
        addSession(session);
      }
    } catch {
      setError("Network error");
    } finally {
      setVibeLoading(false);
    }
  }

  function addReferenceFromResult(img: ImageResult) {
    const ref: ReferenceImage = {
      id: uid(),
      kind: "result",
      // Use thumbUrl (typically <500KB) — full-res CDN images can exceed the
      // 5MB Anthropic vision limit. Vibe is preserved at thumb resolution.
      source: img.thumbUrl,
      thumbUrl: img.thumbUrl,
    };
    setReferences(prev => {
      if (prev.length >= MAX_REFS) return [...prev.slice(1), ref];
      return [...prev, ref];
    });
  }

  async function addReferenceFromFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (${Math.round(file.size / 1024 / 1024)}MB, max 20MB).`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Only image files are accepted.");
      return;
    }
    try {
      const dataUrl = await resizeImageFile(file, MAX_UPLOAD_DIM);
      const ref: ReferenceImage = {
        id: uid(),
        kind: "upload",
        source: dataUrl,
        thumbUrl: dataUrl,
      };
      setReferences(prev => {
        if (prev.length >= MAX_REFS) return [...prev.slice(1), ref];
        return [...prev, ref];
      });
    } catch {
      setError("Could not read image file.");
    }
  }

  function addReferenceFromUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
    } catch {
      setError("That doesn't look like a valid URL.");
      return;
    }
    const ref: ReferenceImage = {
      id: uid(),
      kind: "url",
      source: trimmed,
      thumbUrl: trimmed,
    };
    setReferences(prev => {
      if (prev.length >= MAX_REFS) return [...prev.slice(1), ref];
      return [...prev, ref];
    });
    setUrlInput("");
  }

  function removeReference(id: string) {
    setReferences(prev => prev.filter(r => r.id !== id));
  }

  function clearReferences() {
    setReferences([]);
  }

  // ─── Upload pool intake ───────────────────────────────────────────────────

  async function intakeFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadIntakeLoading(true);
    setError(null);
    try {
      const result = await uploadPool.addFiles(files);
      if (result.skipped.length > 0 && result.added.length === 0) {
        setError(`Skipped ${result.skipped.length}: ${result.skipped[0].reason}`);
      } else if (result.skipped.length > 0) {
        setError(`Added ${result.added.length}, skipped ${result.skipped.length} (${result.skipped[0].reason})`);
      }
    } finally {
      setUploadIntakeLoading(false);
    }
  }

  function handleUploadsDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setUploadsDragOver(false);
    // Files / folder
    extractFilesFromDataTransfer(e.dataTransfer).then(all => {
      const images = all.filter(f => f.type.startsWith("image/"));
      if (images.length > 0) {
        // Switch to the uploads tab so the user sees what they dropped.
        setActiveSessionId(UPLOADS_TAB_ID);
        void intakeFiles(images);
      }
    });
  }

  function handleBatchFilesInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) {
      setActiveSessionId(UPLOADS_TAB_ID);
      void intakeFiles(files);
    }
  }

  async function findSimilarForUpload(upload: UploadedImage) {
    if (vibeLoading || uploadFindSimilarId) return;
    setUploadFindSimilarId(upload.id);
    setError(null);
    try {
      // Read the resized blob as base64 → /api/similar accepts base64 input.
      const base64 = await blobUrlToBase64(upload.blobUrl);
      const inputs: SimilarSearchInput[] = [
        { base64, mediaType: upload.mime || "image/jpeg" },
      ];
      const res = await fetch("/api/similar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: inputs, providers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Vibe search failed");
      } else {
        const data: SimilarSearchResponse = await res.json();
        const session: ResultSet = {
          id: uid(),
          kind: "vibe",
          label: vibeLabel(data.vibe),
          createdAt: Date.now(),
          queries: data.vibe.queries,
          vibe: data.vibe,
          results: data.results,
        };
        addSession(session);
      }
    } catch {
      setError("Network error");
    } finally {
      setUploadFindSimilarId(null);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);

    // Internal drag from a result card carries our own MIME type with the
    // full ImageResult. Prefer it over file/URL paths.
    const internal = e.dataTransfer.getData("application/x-moodboard-result");
    if (internal) {
      try {
        const img = JSON.parse(internal) as ImageResult;
        if (img && img.thumbUrl && img.provider) {
          addReferenceFromResult(img);
          return;
        }
      } catch {
        // fall through to file/URL paths
      }
    }

    const file = e.dataTransfer.files[0];
    if (file) {
      addReferenceFromFile(file);
      return;
    }

    // Browser-provided URL drag (text/uri-list when dragging images from
    // other tabs or apps).
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (uri && uri.startsWith("http")) {
      addReferenceFromUrl(uri.trim().split("\n")[0]);
    }
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) addReferenceFromFile(file);
    e.target.value = "";
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) addReferenceFromFile(file);
    }
  }

  const apiProviders: Provider[] = ["unsplash", "pexels", "pixabay"];
  const allMissing = missingKeys && apiProviders.every(p => missingKeys[p]);

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <form onSubmit={handleKeywordSearch} className="border-b border-neutral-800 p-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-400">
          Describe your mood
        </label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g. moody 90s film noir interiors, warm tungsten, rain on glass"
          rows={3}
          className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {ALL.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => toggleProvider(p)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs capitalize transition",
                providers.includes(p)
                  ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                  : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300",
              )}
            >
              {p === "arena" ? "are.na" : p === "cosmos" ? "cosmos.so" : p}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={keywordLoading || !prompt.trim()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-40"
        >
          {keywordLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {keywordLoading ? "Searching…" : "Find images"}
        </button>
      </form>

      <div
        className={cn(
          "border-b border-neutral-800 p-4 transition",
          dragOver && "border-blue-500/50 bg-blue-500/5",
        )}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <label className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-neutral-400">
          <Sparkles className="h-3 w-3" /> Or find by vibe
        </label>

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition hover:border-neutral-700 hover:text-white"
          >
            <Upload className="h-3 w-3" /> Upload
          </button>
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addReferenceFromUrl(urlInput);
                }
              }}
              placeholder="or paste image URL"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 py-1.5 pl-7 pr-2 text-[11px] text-neutral-200 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {references.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {references.map(ref => (
              <ReferenceThumb key={ref.id} ref_={ref} onRemove={() => removeReference(ref.id)} />
            ))}
            {references.length < MAX_REFS && (
              <span className="text-[10px] text-neutral-500">
                {MAX_REFS - references.length} more allowed
              </span>
            )}
            <button
              type="button"
              onClick={clearReferences}
              className="ml-auto text-[10px] text-neutral-500 hover:text-neutral-300"
            >
              clear
            </button>
          </div>
        ) : (
          <p className="mb-2 rounded-md border border-dashed border-neutral-800 px-3 py-3 text-center text-[11px] text-neutral-500">
            Drag images here, upload, or paste a URL. Up to {MAX_REFS} for combined vibe.
          </p>
        )}

        <button
          type="button"
          onClick={handleVibeSearch}
          disabled={references.length === 0 || vibeLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
        >
          {vibeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {vibeLoading
            ? "Reading vibe…"
            : `Find similar${references.length > 0 ? ` (${references.length})` : ""}`}
        </button>
      </div>

      <div className="border-b border-neutral-800 px-3 py-2">
        <div className="flex flex-nowrap gap-1.5 overflow-x-auto">
          <UploadsTab
            count={uploadPool.uploads.length}
            active={uploadsTabActive}
            onSelect={() => setActiveSessionId(UPLOADS_TAB_ID)}
          />
          {sessions.map(s => (
            <SessionTab
              key={s.id}
              session={s}
              active={s.id === activeSessionId}
              onSelect={() => setActiveSessionId(s.id)}
              onClose={() => removeSession(s.id)}
            />
          ))}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto p-3 transition",
          uploadsTabActive && uploadsDragOver && "bg-violet-500/5",
        )}
        onDragOver={
          uploadsTabActive
            ? e => {
                if (Array.from(e.dataTransfer.types).includes("Files")) {
                  e.preventDefault();
                  setUploadsDragOver(true);
                }
              }
            : undefined
        }
        onDragLeave={uploadsTabActive ? () => setUploadsDragOver(false) : undefined}
        onDrop={uploadsTabActive ? handleUploadsDrop : undefined}
      >
        {uploadsTabActive ? (
          <UploadsView
            uploads={uploadPool.uploads}
            softCap={uploadPool.softCap}
            hardCap={uploadPool.hardCap}
            loading={uploadIntakeLoading}
            findSimilarId={uploadFindSimilarId}
            error={error}
            onPickFiles={() => batchInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onAdd={u => onUploadAddToCanvas(u)}
            onAddAll={uploads =>
              onSendAllToCanvas(uploads.map(uploadToImageResult))
            }
            onFindSimilar={findSimilarForUpload}
            onRemove={uploadPool.removeUpload}
            onClearAll={uploadPool.clearUploads}
          />
        ) : (
          <>
            {activeSession?.kind === "vibe" && activeSession.vibe && (
              <VibeSummaryLine vibe={activeSession.vibe} />
            )}

            {activeSession && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  {activeSession.results.length} results
                </span>
                {activeSession.results.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSendAllToCanvas(activeSession.results)}
                    className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-700"
                    title="Add every result in this session to the canvas"
                  >
                    <Plus className="h-3 w-3" /> Add all ({activeSession.results.length})
                  </button>
                )}
              </div>
            )}

            {allMissing && (
              <div className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
                No API keys found. Add{" "}
                <code className="rounded bg-amber-900/40 px-1">UNSPLASH_ACCESS_KEY</code>,{" "}
                <code className="rounded bg-amber-900/40 px-1">PEXELS_API_KEY</code>, or{" "}
                <code className="rounded bg-amber-900/40 px-1">PIXABAY_API_KEY</code> to{" "}
                <code className="rounded bg-amber-900/40 px-1">.env.local</code> and restart.
              </div>
            )}

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            {!activeSession && !keywordLoading && !vibeLoading && !error && (
              <p className="mt-8 text-center text-sm text-neutral-600">Results will appear here.</p>
            )}

            {activeSession && (
              <div className="grid grid-cols-2 gap-2">
                {activeSession.results.map(img => (
                  <ResultCard
                    key={`${img.provider}:${img.id}`}
                    img={img}
                    onAdd={onAdd}
                    onFindSimilar={() => addReferenceFromResult(img)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hidden file pickers for the My uploads tab */}
      <input
        ref={batchInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleBatchFilesInput}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error — non-standard but widely supported folder picker hint
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleBatchFilesInput}
      />
    </div>
  );
}

function ResultCard({
  img,
  onAdd,
  onFindSimilar,
}: {
  img: ImageResult;
  onAdd: (img: ImageResult) => void;
  onFindSimilar: () => void;
}) {
  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-moodboard-result", JSON.stringify(img));
    // Best-effort drag preview so the user sees what they're dragging.
    e.dataTransfer.setData("text/plain", img.thumbUrl);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative cursor-grab overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 active:cursor-grabbing"
      title="Drag to vibe panel to find similar"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={proxied(img.thumbUrl)}
        alt={img.alt ?? ""}
        className="aspect-[4/3] w-full object-cover"
        loading="lazy"
        draggable={false}
      />
      <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-transparent to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onFindSimilar}
            className="rounded bg-black/60 p-1 text-neutral-200 hover:bg-violet-500 hover:text-white"
            title="Find similar to this"
          >
            <Sparkles className="h-3 w-3" />
          </button>
          <a
            href={img.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-black/60 p-1 text-neutral-300 hover:text-white"
            title="Source"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-end justify-between">
          <span className="truncate text-[10px] text-neutral-300">
            {img.author} · {img.provider}
          </span>
          <button
            onClick={() => onAdd(img)}
            className="flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-medium text-neutral-950"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

function ReferenceThumb({ ref_, onRemove }: { ref_: ReferenceImage; onRemove: () => void }) {
  const src = ref_.kind === "upload" ? ref_.thumbUrl : proxied(ref_.thumbUrl);
  return (
    <div className="group/thumb relative h-12 w-12 overflow-hidden rounded border border-neutral-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-neutral-200 opacity-0 transition group-hover/thumb:opacity-100 hover:bg-red-500 hover:text-white"
        title="Remove"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function SessionTab({
  session,
  active,
  onSelect,
  onClose,
}: {
  session: ResultSet;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const Icon = session.kind === "vibe" ? Sparkles : Search;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition",
        active
          ? session.kind === "vibe"
            ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
            : "border-neutral-600 bg-neutral-800 text-neutral-100"
          : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300",
      )}
    >
      <button onClick={onSelect} className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="max-w-[120px] truncate">{session.label}</span>
        <span className="text-[10px] opacity-60">{session.results.length}</span>
      </button>
      <button
        onClick={onClose}
        className="rounded p-0.5 hover:bg-black/40 hover:text-white"
        title="Close"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function VibeSummaryLine({ vibe }: { vibe: VibeSummary }) {
  return (
    <div className="mb-3 rounded-md border border-violet-900/40 bg-violet-950/20 px-3 py-2">
      <div className="flex items-start gap-1.5">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-wider text-violet-400">
            Vibe · {vibe.domain}
          </p>
          <p className="mt-0.5 text-xs text-neutral-200">{vibe.summary}</p>
          {vibe.queries.length > 0 && (
            <p className="mt-1 text-[10px] text-neutral-500">
              Looking for: {vibe.queries.map(q => `"${q}"`).join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function vibeLabel(vibe: VibeSummary): string {
  const firstWord = vibe.summary.split(/[,;.]/)[0]?.trim() ?? vibe.domain;
  return truncate(firstWord, 22);
}

async function resizeImageFile(file: File, maxDim: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Read a blob URL into a raw base64 string (no data: prefix) for /api/similar.
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

// ─── Uploads tab + view ──────────────────────────────────────────────────────

function UploadsTab({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
        active
          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
          : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300",
      )}
      title="Your uploaded images"
    >
      <Images className="h-3 w-3" />
      <span>My uploads</span>
      <span className="text-[10px] opacity-60">{count}</span>
    </button>
  );
}

function UploadsView({
  uploads,
  softCap,
  hardCap,
  loading,
  findSimilarId,
  error,
  onPickFiles,
  onPickFolder,
  onAdd,
  onAddAll,
  onFindSimilar,
  onRemove,
  onClearAll,
}: {
  uploads: UploadedImage[];
  softCap: number;
  hardCap: number;
  loading: boolean;
  findSimilarId: string | null;
  error: string | null;
  onPickFiles: () => void;
  onPickFolder: () => void;
  onAdd: (u: UploadedImage) => void;
  onAddAll: (uploads: UploadedImage[]) => void;
  onFindSimilar: (u: UploadedImage) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  const overSoft = uploads.length >= softCap;
  const atHard = uploads.length >= hardCap;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPickFiles}
          disabled={loading || atHard}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-200 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
        >
          <Upload className="h-3 w-3" /> Add images
        </button>
        <button
          type="button"
          onClick={onPickFolder}
          disabled={loading || atHard}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-200 transition hover:border-neutral-700 hover:text-white disabled:opacity-30"
        >
          <FolderOpen className="h-3 w-3" /> Add folder
        </button>
        {uploads.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Remove all ${uploads.length} uploads from this session?`)) onClearAll();
            }}
            className="ml-auto flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-[10px] text-neutral-400 transition hover:border-red-500/50 hover:text-red-300"
            title="Clear all uploads"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {uploads.length > 0 && (
        <button
          type="button"
          onClick={() => onAddAll(uploads)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white px-3 py-2 text-xs font-medium text-neutral-950 transition hover:bg-neutral-200"
          title="Place every upload on the canvas in a grid"
        >
          <Plus className="h-3.5 w-3.5" /> Add all {uploads.length} to canvas
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading images…
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {overSoft && !atHard && (
        <p className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
          Heads up — over {softCap} uploads in this session. Performance stays fine but the pool is getting busy.
        </p>
      )}
      {atHard && (
        <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">
          Upload pool is full ({hardCap}). Remove some before adding more.
        </p>
      )}

      {uploads.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-neutral-700 bg-neutral-900/40 px-4 py-8 text-center">
          <Images className="mx-auto mb-2 h-6 w-6 text-neutral-600" />
          <p className="text-sm text-neutral-300">Drop a folder of images here</p>
          <p className="mt-1 text-[11px] text-neutral-500">
            …or drop straight on the canvas to lay them out
          </p>
          <p className="mt-3 text-[10px] text-neutral-600">
            They stay for this session — refresh wipes them
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {uploads.map(u => (
            <UploadCard
              key={u.id}
              upload={u}
              loadingSimilar={findSimilarId === u.id}
              onAdd={onAdd}
              onFindSimilar={onFindSimilar}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadCard({
  upload,
  loadingSimilar,
  onAdd,
  onFindSimilar,
  onRemove,
}: {
  upload: UploadedImage;
  loadingSimilar: boolean;
  onAdd: (u: UploadedImage) => void;
  onFindSimilar: (u: UploadedImage) => void;
  onRemove: (id: string) => void;
}) {
  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-moodboard-upload", upload.id);
    e.dataTransfer.setData("text/plain", upload.filename);
    // Also expose an ImageResult shape so the existing vibe drop-zone can
    // consume it (drag-to-vibe-zone returns the upload as a reference).
    e.dataTransfer.setData(
      "application/x-moodboard-result",
      JSON.stringify(uploadToImageResult(upload)),
    );
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative cursor-grab overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 active:cursor-grabbing"
      title="Drag to canvas, or use buttons below"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={upload.blobUrl}
        alt={upload.filename}
        className="aspect-[4/3] w-full object-cover"
        loading="lazy"
        draggable={false}
      />
      <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-transparent to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => onFindSimilar(upload)}
            disabled={loadingSimilar}
            className="rounded bg-black/60 p-1 text-neutral-200 hover:bg-violet-500 hover:text-white disabled:opacity-50"
            title="Find similar to this"
          >
            {loadingSimilar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => onRemove(upload.id)}
            className="rounded bg-black/60 p-1 text-neutral-300 hover:bg-red-500 hover:text-white"
            title="Remove from pool"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="truncate text-[10px] text-neutral-300" title={upload.filename}>
            {upload.filename}
          </span>
          <button
            onClick={() => onAdd(upload)}
            className="flex shrink-0 items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-medium text-neutral-950"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
