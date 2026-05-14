export type Provider =
  | "unsplash"
  | "pexels"
  | "pixabay"
  | "pinterest"
  | "arena"
  | "cosmos"
  | "upload";

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

// ─── Vibe search (Haiku-powered) ─────────────────────────────────────────────

export type VibeDomain =
  | "architecture"
  | "interior"
  | "photography"
  | "graphic"
  | "fashion"
  | "nature"
  | "abstract"
  | "object"
  | "other";

export interface VibePayload {
  domain: VibeDomain;
  summary: string;
  mood: string[];
  palette: string[];
  style?: string;
  materials?: string[];
  composition?: string;
  lens?: string;
  subjects: string[];
  queries: string[];
}

export interface VibeSummary {
  domain: VibeDomain;
  summary: string;
  queries: string[];
}

export interface ReferenceImage {
  id: string;
  kind: "result" | "upload" | "url";
  source: string;
  thumbUrl: string;
}

export interface SimilarSearchInput {
  url?: string;
  base64?: string;
  mediaType?: string;
}

export interface SimilarSearchRequest {
  images: SimilarSearchInput[];
  providers: Provider[];
}

export interface SimilarSearchResponse {
  results: ImageResult[];
  vibe: VibeSummary;
  cached?: boolean;
}

export interface ResultSet {
  id: string;
  kind: "keyword" | "vibe";
  label: string;
  createdAt: number;
  queries: string[];
  vibe?: VibeSummary;
  results: ImageResult[];
}

// ─── User uploads (Mode A + Mode B intake) ───────────────────────────────────

export interface UploadedImage {
  id: string;
  blobUrl: string;
  width: number;
  height: number;
  filename: string;
  mime: string;
  bytes: number;
  addedAt: number;
}

// ─── Refine: cluster the board into 2-3 vibe groups ──────────────────────────

export interface VibeCluster {
  id: string;
  label: string;       // short e.g. "moody cinematic"
  summary: string;     // one-sentence description
  itemIds: string[];   // BoardItem ids that belong here
}

export interface ClusterRequestItem {
  id: string;          // BoardItem id
  url?: string;        // for provider images served from CDN
  base64?: string;     // for uploads (blob:/data: URLs cannot be fetched server-side)
  mediaType?: string;
}

export interface ClusterRequest {
  items: ClusterRequestItem[];
}

export interface ClusterResponse {
  clusters: VibeCluster[];
}
