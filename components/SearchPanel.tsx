"use client";

import { useState, FormEvent } from "react";
import type { ImageResult, Provider } from "@/lib/types";
import { cn, proxied } from "@/lib/utils";
import { Search, Plus, Loader2, ExternalLink, X } from "lucide-react";

const ALL: Provider[] = ["unsplash", "pexels", "pixabay", "pinterest", "arena", "cosmos"];

interface Props {
  onAdd: (img: ImageResult) => void;
}

export default function SearchPanel({ onAdd }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [providers, setProviders] = useState<Provider[]>([...ALL]);
  const [error, setError] = useState<string | null>(null);
  const [missingKeys, setMissingKeys] = useState<Record<Provider, boolean> | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, providers }),
      });
      if (!res.ok) {
        setError("Search failed");
        setResults([]);
      } else {
        const data = await res.json();
        setResults(data.results ?? []);
        setQueries(data.queries ?? []);
        setMissingKeys(data.missingKeys ?? null);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function toggleProvider(p: Provider) {
    setProviders(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]));
  }

  const apiProviders: Provider[] = ["unsplash", "pexels", "pixabay"];
  const allMissing = missingKeys && apiProviders.every(p => missingKeys[p]);

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <form onSubmit={handleSubmit} className="border-b border-neutral-800 p-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-neutral-400">
          Describe your mood
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. moody 90s film noir interiors, warm tungsten, rain on glass"
            rows={3}
            className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
          />
        </div>

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
          disabled={loading || !prompt.trim()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Searching…" : "Find images"}
        </button>

        {queries.length > 0 && !loading && (
          <p className="mt-2 text-[11px] text-neutral-500">
            Expanded to: {queries.map(q => `"${q}"`).join(", ")}
          </p>
        )}
      </form>

      <div className="flex-1 overflow-y-auto p-3">
        {results.length > 0 && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-neutral-400">{results.length} results</span>
            <button
              onClick={() => { setResults([]); setQueries([]); }}
              className="flex items-center gap-1 rounded-md border border-neutral-800 px-2 py-1 text-[11px] text-neutral-400 transition hover:border-neutral-600 hover:text-neutral-200"
            >
              <X className="h-3 w-3" /> Clear results
            </button>
          </div>
        )}
        {allMissing && (
          <div className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200">
            No API keys found. Add <code className="rounded bg-amber-900/40 px-1">UNSPLASH_ACCESS_KEY</code>,
            {" "}<code className="rounded bg-amber-900/40 px-1">PEXELS_API_KEY</code>, or
            {" "}<code className="rounded bg-amber-900/40 px-1">PIXABAY_API_KEY</code> to{" "}
            <code className="rounded bg-amber-900/40 px-1">.env.local</code> and restart.
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && results.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            Results will appear here.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {results.map(img => (
            <ResultCard key={img.id} img={img} onAdd={onAdd} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ img, onAdd }: { img: ImageResult; onAdd: (img: ImageResult) => void }) {
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
        <div className="flex justify-end">
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
          <span className="text-[10px] text-neutral-300 truncate">
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
