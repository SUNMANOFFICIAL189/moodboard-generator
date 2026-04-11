import type { ImageResult } from "../types";

const BASE = "https://api.unsplash.com/search/photos";

export async function searchUnsplash(query: string, perPage = 12): Promise<ImageResult[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  const url = `${BASE}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results ?? []).map((p: UnsplashPhoto): ImageResult => ({
    id: `unsplash-${p.id}`,
    provider: "unsplash",
    thumbUrl: p.urls.small,
    fullUrl: p.urls.regular,
    width: p.width,
    height: p.height,
    author: p.user.name,
    authorUrl: p.user.links.html,
    sourceUrl: p.links.html,
    alt: p.alt_description ?? query,
  }));
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  alt_description: string | null;
  urls: { small: string; regular: string };
  user: { name: string; links: { html: string } };
  links: { html: string };
}
