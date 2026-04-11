import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/providers";
import { expandQuery } from "@/lib/expand";
import type { ImageResult, Provider } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const providers = Array.isArray(body.providers) && body.providers.length
    ? (body.providers as Provider[])
    : (["unsplash", "pexels", "pixabay"] as Provider[]);

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const queries = expandQuery(prompt);
  const perQuery = Math.max(4, Math.floor(24 / queries.length));

  const all: ImageResult[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const batch = await searchAll(q, providers, perQuery);
    for (const img of batch) {
      if (seen.has(img.id)) continue;
      seen.add(img.id);
      all.push(img);
    }
  }

  return NextResponse.json({
    prompt,
    queries,
    results: all,
    missingKeys: {
      unsplash: !process.env.UNSPLASH_ACCESS_KEY,
      pexels: !process.env.PEXELS_API_KEY,
      pixabay: !process.env.PIXABAY_API_KEY,
    },
  });
}
