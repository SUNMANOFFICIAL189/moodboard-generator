export type Provider = "unsplash" | "pexels" | "pixabay";

export interface ImageResult {
  id: string;
  provider: Provider;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  author: string;
  authorUrl?: string;
  sourceUrl: string;
  alt?: string;
}

export interface BoardItem {
  id: string;
  image: ImageResult;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
}
