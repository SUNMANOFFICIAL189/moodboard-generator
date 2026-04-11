import type { ImageResult } from "../types";

const BASE = "https://pixabay.com/api/";

export async function searchPixabay(query: string, perPage = 12): Promise<ImageResult[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];

  const url = `${BASE}?key=${key}&q=${encodeURIComponent(query)}&per_page=${perPage}&image_type=photo&safesearch=true`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();

  return (data.hits ?? []).map((p: PixabayHit): ImageResult => ({
    id: `pixabay-${p.id}`,
    provider: "pixabay",
    thumbUrl: p.webformatURL,
    fullUrl: p.largeImageURL,
    width: p.imageWidth,
    height: p.imageHeight,
    author: p.user,
    authorUrl: `https://pixabay.com/users/${p.user}-${p.user_id}/`,
    sourceUrl: p.pageURL,
    alt: p.tags ?? query,
  }));
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}
