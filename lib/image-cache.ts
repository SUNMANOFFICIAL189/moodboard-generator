import { createHash } from "crypto";
import type { VibePayload } from "./types";

const MAX_ENTRIES = 200;

class LRUCache<V> {
  private map = new Map<string, V>();

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}

const vibeCache = new LRUCache<VibePayload>();
const expandCache = new LRUCache<string[]>();

export function hashBytes(bytes: Uint8Array | Buffer | ArrayBuffer): string {
  const buf =
    bytes instanceof ArrayBuffer ? Buffer.from(bytes) :
    bytes instanceof Buffer ? bytes :
    Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

export function hashString(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function combineHashes(...hashes: string[]): string {
  return createHash("sha256").update(hashes.sort().join(":"), "utf8").digest("hex");
}

export const vibe = {
  get: (key: string) => vibeCache.get(key),
  set: (key: string, value: VibePayload) => vibeCache.set(key, value),
};

export const expand = {
  get: (key: string) => expandCache.get(key),
  set: (key: string, value: string[]) => expandCache.set(key, value),
};
