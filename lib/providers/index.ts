import type { ImageResult, Provider } from "../types";
import { searchUnsplash } from "./unsplash";
import { searchPexels } from "./pexels";
import { searchPixabay } from "./pixabay";
import { searchPinterest } from "./pinterest";

export async function searchAll(
  query: string,
  providers: Provider[] = ["unsplash", "pexels", "pixabay", "pinterest"],
  perPage = 12,
): Promise<ImageResult[]> {
  const jobs: Promise<ImageResult[]>[] = [];
  if (providers.includes("unsplash")) jobs.push(searchUnsplash(query, perPage));
  if (providers.includes("pexels")) jobs.push(searchPexels(query, perPage));
  if (providers.includes("pixabay")) jobs.push(searchPixabay(query, perPage));
  if (providers.includes("pinterest")) jobs.push(searchPinterest(query, perPage));

  const settled = await Promise.allSettled(jobs);
  const results: ImageResult[] = [];
  for (const s of settled) if (s.status === "fulfilled") results.push(...s.value);

  // interleave by provider so results feel varied
  return interleave(results);
}

function interleave(items: ImageResult[]): ImageResult[] {
  const buckets = new Map<Provider, ImageResult[]>();
  for (const it of items) {
    const b = buckets.get(it.provider) ?? [];
    b.push(it);
    buckets.set(it.provider, b);
  }
  const out: ImageResult[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const b of buckets.values()) {
      const next = b.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}
