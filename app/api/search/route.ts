import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/providers";
import { expandQuery } from "@/lib/expand";
import { expandPromptWithHaiku } from "@/lib/vision";
import { hashString, expand as expandCache } from "@/lib/image-cache";
import type { ImageResult, Provider } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALL_PROVIDERS: Provider[] = [
  "unsplash",
  "pexels",
  "pixabay",
  "pinterest",
  "arena",
  "cosmos",
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const providers =
    Array.isArray(body.providers) && body.providers.length
      ? (body.providers as Provider[])
      : ALL_PROVIDERS;

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // Haiku-powered expansion with rule-based fallback.
  // If Haiku is unavailable (no key) or errors, we degrade gracefully.
  const cacheKey = hashString(prompt.toLowerCase());
  let queries: string[] | undefined = expandCache.get(cacheKey);
  let expansionMethod: "haiku" | "rule-based" = "haiku";
  let cached = !!queries;

  if (!queries) {
    try {
      queries = await expandPromptWithHaiku(prompt);
      expandCache.set(cacheKey, queries);
    } catch {
      queries = expandQuery(prompt);
      expansionMethod = "rule-based";
    }
  }

  if (!queries || queries.length === 0) {
    queries = expandQuery(prompt);
    expansionMethod = "rule-based";
  }

  const perQuery = Math.max(4, Math.floor(24 / queries.length));

  const all: ImageResult[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const batch = await searchAll(q, providers, perQuery);
    for (const img of batch) {
      const key = `${img.provider}:${img.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(img);
    }
  }

  return NextResponse.json({
    prompt,
    queries,
    expansionMethod,
    cached,
    results: all,
    missingKeys: {
      unsplash: !process.env.UNSPLASH_ACCESS_KEY,
      pexels: !process.env.PEXELS_API_KEY,
      pixabay: !process.env.PIXABAY_API_KEY,
      pinterest: false,
      arena: false,
      cosmos: false,
    },
  });
}
