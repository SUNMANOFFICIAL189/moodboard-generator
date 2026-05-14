import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function proxied(url: string): string {
  // Local blob/data URLs are already in-process — proxying would 403 against
  // the upstream host allowlist.
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}
