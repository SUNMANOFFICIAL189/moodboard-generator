import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { VibePayload, SimilarSearchInput } from "./types";

const MODEL = "claude-haiku-4-5-20251001";
const VIBE_MAX_TOKENS = 1024;
const EXPAND_MAX_TOKENS = 512;

const VIBE_DOMAIN = z.enum([
  "architecture",
  "interior",
  "photography",
  "graphic",
  "fashion",
  "nature",
  "abstract",
  "object",
  "other",
]);

const VibePayloadSchema = z.object({
  domain: VIBE_DOMAIN,
  summary: z.string().min(1).max(200),
  mood: z.array(z.string()).min(1).max(6),
  palette: z.array(z.string()).min(1).max(8),
  style: z.string().optional(),
  materials: z.array(z.string()).max(8).optional(),
  composition: z.string().optional(),
  lens: z.string().optional(),
  subjects: z.array(z.string()).min(1).max(8),
  queries: z.array(z.string().min(2)).min(3).max(6),
}) satisfies z.ZodType<VibePayload>;

const ExpandResultSchema = z.object({
  queries: z.array(z.string().min(2)).min(3).max(6),
});

const VIBE_TOOL = {
  name: "describe_vibe",
  description:
    "Describe the visual aesthetic of the provided image(s) and produce search queries.",
  input_schema: {
    type: "object" as const,
    properties: {
      domain: {
        type: "string",
        enum: [
          "architecture",
          "interior",
          "photography",
          "graphic",
          "fashion",
          "nature",
          "abstract",
          "object",
          "other",
        ],
        description: "Primary subject domain of the image(s).",
      },
      summary: {
        type: "string",
        description:
          "One-line plain-English vibe summary (max 200 chars). Example: 'brutalist concrete architecture, low contrast, wide angle'.",
      },
      mood: {
        type: "array",
        items: { type: "string" },
        description: "2-6 mood adjectives. e.g. ['moody','cinematic','nostalgic']",
      },
      palette: {
        type: "array",
        items: { type: "string" },
        description: "2-8 dominant colours in plain English. e.g. ['deep teal','burnt orange','muted black']",
      },
      style: {
        type: "string",
        description: "Visual treatment. e.g. 'shot on film, slight grain, low contrast' or 'flat illustration, bold outlines'",
      },
      materials: {
        type: "array",
        items: { type: "string" },
        description: "For architecture/interior/object only: materials. e.g. ['concrete','glass','timber']",
      },
      composition: {
        type: "string",
        description: "Framing. e.g. 'wide, low angle, centred' or 'rule of thirds, off-axis'",
      },
      lens: {
        type: "string",
        description: "For photography only: lens character. e.g. 'telephoto, shallow DOF' or 'wide angle, deep focus'",
      },
      subjects: {
        type: "array",
        items: { type: "string" },
        description: "What is depicted. e.g. ['empty street','neon sign','concrete facade']",
      },
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "3-6 stock-image search queries that would surface visually similar results. Each 2-6 words, blend mood + subject + style. Avoid generic words like 'nice', 'pretty'.",
      },
    },
    required: ["domain", "summary", "mood", "palette", "subjects", "queries"],
  },
};

const EXPAND_TOOL = {
  name: "expand_prompt",
  description: "Expand a moodboard search prompt into 3-6 focused stock-image search queries.",
  input_schema: {
    type: "object" as const,
    properties: {
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "3-6 search queries derived from the prompt. Each 2-6 words. Mix literal phrasing with synonym expansion, reference points (designers, eras, art movements), and visual vocabulary (lens types, film stocks, materials). Aim for visual variety, not redundancy.",
      },
    },
    required: ["queries"],
  },
};

const VIBE_SYSTEM_PROMPT = `You are an art-director's assistant analysing reference images for a moodboard tool. Your job is to extract the visual vibe — the aesthetic essence — and output search queries that will surface visually similar images from stock-photo APIs.

CRITICAL RULES:
1. Classify the PRIMARY DOMAIN first. The lens you describe through depends on the domain:
   - architecture → style era (brutalist, art deco, imperial, mid-century), materials, scale, light
   - interior → era, furniture style, lighting, palette, materials
   - photography → subject, lens character, era/film stock, composition, mood
   - graphic → layout, typography, illustration style, palette
   - fashion → era, silhouette, fabric, mood
   - nature → biome, light, time of day, mood
   - object → material, era, design movement
   - abstract → palette, texture, geometry

2. If multiple images are provided, extract the INTERSECTION vibe — what they share. If they conflict, prioritise the strongest shared signal (mood + palette > subject).

3. Search queries must be 2-6 words, concrete, and image-searchable. Mix subject + style. Avoid filler words.

4. For 'summary': one plain-English sentence under 200 chars. This is shown to the user as a sanity check.`;

const EXPAND_SYSTEM_PROMPT = `You expand short moodboard prompts into rich stock-image search queries. Mix:
- Literal phrasing from the user
- Synonyms and visual vocabulary they didn't use
- Reference points (era, art movement, designer, director) where relevant
- Disambiguation (if 'Brutalist' could mean architecture or graphic design, query both)

Output 3-6 queries, each 2-6 words. Aim for variety, not redundancy. Avoid generic words.`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Restart `npm run dev` to source it from Keychain.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

function asMediaType(mt: string | undefined): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const v = (mt ?? "image/jpeg").toLowerCase();
  if (v === "image/png") return "image/png";
  if (v === "image/gif") return "image/gif";
  if (v === "image/webp") return "image/webp";
  return "image/jpeg";
}

function imageBlock(input: SimilarSearchInput): Anthropic.Messages.ImageBlockParam {
  if (input.base64) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: asMediaType(input.mediaType),
        data: input.base64,
      },
    };
  }
  if (input.url) {
    return {
      type: "image",
      source: { type: "url", url: input.url },
    };
  }
  throw new Error("SimilarSearchInput requires either base64 or url");
}

export async function extractVibe(images: SimilarSearchInput[]): Promise<VibePayload> {
  if (images.length === 0) throw new Error("at least one image required");
  if (images.length > 5) throw new Error("max 5 reference images");

  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...images.map(imageBlock),
    {
      type: "text",
      text:
        images.length === 1
          ? "Analyse this image and call describe_vibe."
          : `Analyse these ${images.length} images. Extract the INTERSECTION vibe — what they share aesthetically. Call describe_vibe.`,
    },
  ];

  const run = async (): Promise<VibePayload> => {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: VIBE_MAX_TOKENS,
      system: VIBE_SYSTEM_PROMPT,
      tools: [VIBE_TOOL],
      tool_choice: { type: "tool", name: "describe_vibe" },
      messages: [{ role: "user", content }],
    });
    const tool = res.content.find(b => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") {
      throw new Error("Haiku did not call describe_vibe");
    }
    return VibePayloadSchema.parse(tool.input);
  };

  try {
    return await run();
  } catch (err) {
    // One retry — schema-validation errors usually resolve on the second pass.
    if (err instanceof z.ZodError) return await run();
    throw err;
  }
}

export async function expandPromptWithHaiku(prompt: string): Promise<string[]> {
  const trimmed = prompt.trim();
  if (!trimmed) return [];

  const run = async (): Promise<string[]> => {
    const res = await client().messages.create({
      model: MODEL,
      max_tokens: EXPAND_MAX_TOKENS,
      system: EXPAND_SYSTEM_PROMPT,
      tools: [EXPAND_TOOL],
      tool_choice: { type: "tool", name: "expand_prompt" },
      messages: [
        {
          role: "user",
          content: `Expand this moodboard prompt:\n\n"${trimmed}"`,
        },
      ],
    });
    const tool = res.content.find(b => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") {
      throw new Error("Haiku did not call expand_prompt");
    }
    return ExpandResultSchema.parse(tool.input).queries;
  };

  try {
    return await run();
  } catch (err) {
    if (err instanceof z.ZodError) return await run();
    throw err;
  }
}
