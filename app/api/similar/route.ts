import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { searchAll } from "@/lib/providers";
import { extractVibe } from "@/lib/vision";
import { hashBytes, combineHashes, vibe as vibeCache } from "@/lib/image-cache";
import type {
  ImageResult,
  Provider,
  SimilarSearchInput,
  SimilarSearchResponse,
  VibePayload,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Anthropic vision caps base64 image at 5MB. We resize anything over this
// threshold (raw bytes, pre-base64) to a max dimension JPEG.
const MAX_RAW_BYTES = 4 * 1024 * 1024;
const RESIZE_MAX_DIM = 1568;

const ALLOWED_HOSTS = new Set([
  "images.unsplash.com",
  "plus.unsplash.com",
  "images.pexels.com",
  "pixabay.com",
  "cdn.pixabay.com",
  "i.pinimg.com",
  "d2w9rnfcy7mm78.cloudfront.net",
  "images.are.na",
  "cdn.cosmos.so",
]);

const ALL_PROVIDERS: Provider[] = [
  "unsplash",
  "pexels",
  "pixabay",
  "pinterest",
  "arena",
  "cosmos",
];

const TOP_QUERIES = 3;
const PER_PROVIDER = 8;

interface NormalisedImage {
  base64: string;
  mediaType: string;
  hash: string;
}

async function shrinkIfOversized(buf: Buffer): Promise<{ buf: Buffer; mediaType: string }> {
  if (buf.byteLength <= MAX_RAW_BYTES) {
    return { buf, mediaType: "image/jpeg" };
  }
  const out = await sharp(buf)
    .rotate()
    .resize(RESIZE_MAX_DIM, RESIZE_MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buf: out, mediaType: "image/jpeg" };
}

async function normaliseImage(input: SimilarSearchInput): Promise<NormalisedImage> {
  if (input.base64) {
    const bytes = Buffer.from(input.base64, "base64");
    const { buf, mediaType } = await shrinkIfOversized(bytes);
    return {
      base64: buf.toString("base64"),
      mediaType: input.mediaType && buf === bytes ? input.mediaType : mediaType,
      hash: hashBytes(buf),
    };
  }
  if (!input.url) throw new Error("image input requires url or base64");

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error(`invalid url: ${input.url}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`host not allowed: ${parsed.hostname}`);
  }

  const res = await fetch(parsed.toString());
  if (!res.ok) throw new Error(`upstream ${res.status} for ${parsed.hostname}`);
  const fetched = Buffer.from(await res.arrayBuffer());
  const upstreamMediaType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const { buf, mediaType } = await shrinkIfOversized(fetched);
  return {
    base64: buf.toString("base64"),
    mediaType: buf === fetched ? upstreamMediaType : mediaType,
    hash: hashBytes(buf),
  };
}

async function searchTopQueries(
  queries: string[],
  providers: Provider[],
): Promise<ImageResult[]> {
  const top = queries.slice(0, TOP_QUERIES);
  const batches = await Promise.all(
    top.map(q => searchAll(q, providers, PER_PROVIDER).catch(() => [] as ImageResult[])),
  );

  const seen = new Set<string>();
  const merged: ImageResult[] = [];
  for (const batch of batches) {
    for (const img of batch) {
      const key = `${img.provider}:${img.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(img);
    }
  }
  return merged;
}

export async function POST(req: NextRequest) {
  let body: { images?: SimilarSearchInput[]; providers?: Provider[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return NextResponse.json({ error: "at least one image required" }, { status: 400 });
  }
  if (images.length > 5) {
    return NextResponse.json({ error: "max 5 reference images" }, { status: 400 });
  }

  const providers =
    Array.isArray(body.providers) && body.providers.length
      ? (body.providers.filter(p => ALL_PROVIDERS.includes(p)) as Provider[])
      : ALL_PROVIDERS;

  let normalised: NormalisedImage[];
  try {
    normalised = await Promise.all(images.map(normaliseImage));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "image fetch failed" },
      { status: 400 },
    );
  }

  const cacheKey = combineHashes(...normalised.map(n => n.hash));
  let payload: VibePayload | undefined = vibeCache.get(cacheKey);
  let cached = false;

  if (payload) {
    cached = true;
  } else {
    try {
      payload = await extractVibe(
        normalised.map(n => ({ base64: n.base64, mediaType: n.mediaType })),
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "vibe extraction failed" },
        { status: 502 },
      );
    }
    vibeCache.set(cacheKey, payload);
  }

  const results = await searchTopQueries(payload.queries, providers);

  const response: SimilarSearchResponse = {
    results,
    vibe: {
      domain: payload.domain,
      summary: payload.summary,
      queries: payload.queries.slice(0, TOP_QUERIES),
    },
    cached,
  };

  return NextResponse.json(response);
}
