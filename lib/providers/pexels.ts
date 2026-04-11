import type { ImageResult } from "../types";

const BASE = "https://api.pexels.com/v1/search";

export async function searchPexels(query: string, perPage = 12): Promise<ImageResult[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];

  const url = `${BASE}?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const res = await fetch(url, {
    headers: { Authorization: key },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const data = await res.json();

  return (data.photos ?? []).map((p: PexelsPhoto): ImageResult => ({
    id: `pexels-${p.id}`,
    provider: "pexels",
    thumbUrl: p.src.medium,
    fullUrl: p.src.large2x ?? p.src.large,
    width: p.width,
    height: p.height,
    author: p.photographer,
    authorUrl: p.photographer_url,
    sourceUrl: p.url,
    alt: p.alt ?? query,
  }));
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string;
  src: { medium: string; large: string; large2x: string };
}
