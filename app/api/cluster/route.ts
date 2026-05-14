import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { clusterByVibe } from "@/lib/vision";
import type {
  ClusterRequest,
  ClusterRequestItem,
  ClusterResponse,
  SimilarSearchInput,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_RAW_BYTES = 4 * 1024 * 1024;
const RESIZE_MAX_DIM = 1568;
const MAX_ITEMS = 50;

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

async function shrinkIfOversized(
  buf: Buffer,
): Promise<{ buf: Buffer; mediaType: string }> {
  if (buf.byteLength <= MAX_RAW_BYTES) {
    return { buf, mediaType: "image/jpeg" };
  }
  const out = await sharp(buf)
    .rotate()
    .resize(RESIZE_MAX_DIM, RESIZE_MAX_DIM, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buf: out, mediaType: "image/jpeg" };
}

async function fetchToVisionInput(
  item: ClusterRequestItem,
): Promise<SimilarSearchInput> {
  if (item.base64) {
    const bytes = Buffer.from(item.base64, "base64");
    const { buf, mediaType } = await shrinkIfOversized(bytes);
    return {
      base64: buf.toString("base64"),
      mediaType: item.mediaType && buf === bytes ? item.mediaType : mediaType,
    };
  }
  if (!item.url) throw new Error(`item ${item.id} missing url and base64`);

  let parsed: URL;
  try {
    parsed = new URL(item.url);
  } catch {
    throw new Error(`item ${item.id} invalid url`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`item ${item.id} host not allowed: ${parsed.hostname}`);
  }
  const res = await fetch(parsed.toString());
  if (!res.ok) {
    throw new Error(`item ${item.id} upstream ${res.status}`);
  }
  const fetched = Buffer.from(await res.arrayBuffer());
  const upstreamMediaType =
    res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const { buf, mediaType } = await shrinkIfOversized(fetched);
  return {
    base64: buf.toString("base64"),
    mediaType: buf === fetched ? upstreamMediaType : mediaType,
  };
}

export async function POST(req: NextRequest) {
  let body: ClusterRequest;
  try {
    body = (await req.json()) as ClusterRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 images to cluster" },
      { status: 400 },
    );
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Too many images — max ${MAX_ITEMS} per refine` },
      { status: 400 },
    );
  }

  const itemIds = items.map(it => it.id);

  let visionInputs: SimilarSearchInput[];
  try {
    visionInputs = await Promise.all(items.map(fetchToVisionInput));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "image prep failed" },
      { status: 400 },
    );
  }

  try {
    const clusters = await clusterByVibe(visionInputs, itemIds);
    const response: ClusterResponse = { clusters };
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "cluster failed" },
      { status: 502 },
    );
  }
}
