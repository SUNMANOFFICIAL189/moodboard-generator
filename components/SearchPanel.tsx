"use client";

import { useState, useRef, FormEvent, ChangeEvent, DragEvent, ClipboardEvent } from "react";
import type {
  ImageResult,
  Provider,
  ReferenceImage,
  ResultSet,
  SimilarSearchInput,
  SimilarSearchResponse,
  VibeSummary,
} from "@/lib/types";
import { cn, proxied, uid } from "@/lib/utils";
import {
  Search,
  Plus,
  Loader2,
  ExternalLink,
  X,
  Sparkles,
  Upload,
  Link2,
} from "lucide-react";

const ALL: Provider[] = ["unsplash", "pexels", "pixabay", "pinterest", "arena", "cosmos"];
const MAX_REFS = 3;
const MAX_SESSIONS = 5;
const MAX_UPLOAD_DIM = 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface Props {
  onAdd: (img: ImageResult) => void;
}

export default function SearchPanel({ onAdd }: Props) {
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

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
      source: img.fullUrl,
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

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) addReferenceFromFile(file);
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

      {sessions.length > 0 && (
        <div className="border-b border-neutral-800 px-3 py-2">
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto">
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
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {activeSession?.kind === "vibe" && activeSession.vibe && (
          <VibeSummaryLine vibe={activeSession.vibe} />
        )}

        {activeSession && (
          <div className="mb-2 text-xs text-neutral-400">{activeSession.results.length} results</div>
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
      </div>
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
  return (
    <div className="group relative overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={proxied(img.thumbUrl)}
        alt={img.alt ?? ""}
        className="aspect-[4/3] w-full object-cover"
        loading="lazy"
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
