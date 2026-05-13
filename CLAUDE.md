# Moodboard Generator

## Project

Interactive web app: describe a mood **or drop in a reference image** → pull images from 6 providers → arrange on a canvas → export.

- **Repo:** https://github.com/SUNMANOFFICIAL189/moodboard-generator
- **Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · react-konva · puppeteer-core · JSZip · @anthropic-ai/sdk · zod · sharp (transitive)
- **Run:** `npm run dev` — port depends on version (see below)
- **Build:** `npm run build`

## Versions & worktree layout

| Version | Path | Branch | Port | Use it for |
|---|---|---|---|---|
| **v1** | `~/projects/moodboard-generator` | `main` | `:3000` | The shipped product — keyword search + canvas only |
| **v2** | `~/projects/moodboard-generator-v2` | `feat/v2-haiku-vibe` | `:3002` | The Haiku-powered version with vibe reverse-search and richer text expansion |

Both share `.git` (worktree) and `.env.local` (symlink). `:3001` is taken by Mission Control Fleet — keep clear of it.

### Rollback model

- Checkpoint tag `v1-stable` points at commit `63dc6d2` (last clean v1 commit). Immutable.
- Abandon v2 entirely: `git worktree remove ~/projects/moodboard-generator-v2 && git branch -D feat/v2-haiku-vibe`. v1 is never touched.
- Compare v1 and v2 side-by-side: run each from its own directory, open `:3000` and `:3002` in separate browser tabs.

## Architecture

```
app/
  page.tsx                — main layout: sidebar search + canvas
  api/search/route.ts     — POST: Haiku expansion + 6-provider search (v2: rule-based fallback)
  api/similar/route.ts    — POST: vibe extraction from image(s) → search        (v2 only)
  api/proxy/route.ts      — GET:  image proxy with host allowlist
components/
  SearchPanel.tsx         — prompt + drop-zone + reference strip + session tabs (v2: extended)
  Canvas.tsx              — react-konva board: drag/resize/rotate/pan/zoom, grid snap
lib/
  vision.ts               — Haiku 4.5 client: extractVibe(images), expandPromptWithHaiku(text)  (v2 only)
  image-cache.ts          — in-memory LRU keyed by SHA-256 of content                            (v2 only)
  providers/              — unsplash.ts, pexels.ts, pixabay.ts, pinterest.ts, arena.ts, cosmos.ts, index.ts
  store.ts                — useBoard() hook, localStorage persistence
  expand.ts               — rule-based query expansion (fallback when Haiku unavailable)
  export.ts               — ZIP (with CREDITS.md) + PNG canvas snapshot
  types.ts                — Provider, ImageResult, BoardItem, VibePayload, ResultSet, etc.
  utils.ts                — cn(), uid(), proxied()
```

## Image providers

| Provider | Auth | Notes |
|----------|------|-------|
| Unsplash | `UNSPLASH_ACCESS_KEY` in `.env.local` | Free, 50 req/hr demo |
| Pexels | `PEXELS_API_KEY` in `.env.local` | Free, 200 req/hr |
| Pixabay | `PIXABAY_API_KEY` in `.env.local` | Free, 100 req/min |
| Pinterest | None — uses local Chrome via puppeteer-core | Headless scrape, graceful fallback |
| Are.na | None | Public API |
| Cosmos.so | None | Public API |

App works with any subset of keys. Pinterest needs Chrome at `/Applications/Google Chrome.app/`.

## Vibe search (v2)

Two entry points trigger a Haiku vision call:

1. **Click the Sparkles icon** on any result card → that image joins the reference strip.
2. **Drop-zone** under the prompt input → drag image from desktop, click Upload, or paste an image URL.

Up to **3 reference images** can be combined — Haiku is asked to extract the *intersection* vibe across them. The extracted payload (domain, mood, palette, materials/lens, subjects, queries) is cached by SHA-256 hash of the source image bytes, so re-running the same source is free.

### Result sessions

Each search action — keyword OR vibe — creates a new **session** (max 5, oldest evicted). Pill tabs above the results let you toggle between sessions. Vibe sessions show a violet "Vibe" summary line above their results explaining what Haiku saw.

## Key design decisions

- Server-side key handling only — `ANTHROPIC_API_KEY` and provider keys never reach the client.
- `/api/proxy` and `/api/similar` share the same image-host allowlist (Unsplash, Pexels, Pixabay, Pinterest CDN, Are.na, Cosmos.so).
- Pinterest provider launches a shared headless Chrome instance (pooled, not per-request).
- Grid snap: 10px gap between edges, also snaps to alignment (left/right/top/bottom/center), 12px threshold.
- localStorage for board persistence, no backend DB.
- `_API/` and `_TERMINAL_SCRIPT/` are gitignored (contain local credentials).
- Haiku failures degrade gracefully to rule-based expansion — Haiku is a quality upgrade, not a hard dependency.
- Server-side `sharp` resizes any image >4MB to max 1568px JPEG before sending to Anthropic vision (5MB API limit). Client-side resize on uploads to 1024px before send.

## API keys

| Key | Location | How |
|---|---|---|
| `UNSPLASH_ACCESS_KEY` / `UNSPLASH_SECRET_KEY` | `.env.local` (plaintext) | Existing pattern |
| `PEXELS_API_KEY` | `.env.local` (plaintext) | Existing pattern |
| `PIXABAY_API_KEY` | `.env.local` (plaintext) | Existing pattern |
| `ANTHROPIC_API_KEY` | macOS Keychain — entry name `claude-mcp-anthropic-api-key` | Pulled at `npm run dev` startup; no plaintext on disk |

To add a new Anthropic key:
```
security add-generic-password -U -a "$USER" -s claude-mcp-anthropic-api-key -w <KEY>
```

To verify the key is present without echoing its value:
```
security find-generic-password -a "$USER" -s claude-mcp-anthropic-api-key -w > /dev/null && echo PRESENT
```

## Knowledge layer links

- **Obsidian:** `~/Vaults/Jarvis-Brain/JARVIS-BRAIN/Moodboard Generator.md`
- **Auto-memory:** `~/.claude/projects/-Users-sunil-rajput-claude-hq/memory/project_moodboard_generator.md`
- **claude-mem:** Observations auto-captured (search "moodboard generator")
- **MISSION_BOARD.md:** In project root — phase tracker

## What's done

### v1 (tag `v1-stable`, commit `63dc6d2`)
- [x] 6-provider parallel image search with rule-based query expansion
- [x] Search UI with provider toggles + clear results
- [x] Interactive canvas (drag/resize/rotate/pan/zoom/z-order)
- [x] Grid snap system (10px gap, toggleable)
- [x] Export: ZIP with CREDITS.md + PNG snapshot
- [x] localStorage board persistence
- [x] Pinterest provider via puppeteer-core
- [x] Are.na + Cosmos.so providers
- [x] GitHub repo created and pushed

### v2 (branch `feat/v2-haiku-vibe`)
- [x] Haiku 4.5 client (`lib/vision.ts`) with forced tool-use + Zod validation
- [x] Domain-aware vibe extraction (architecture / interior / photo / graphic / fashion / nature / abstract / object)
- [x] Multi-image intersection vibe (up to 3 references)
- [x] `/api/similar` endpoint with content-hash caching
- [x] Haiku-powered text expansion (was a v1 "Next Steps" item)
- [x] Rule-based fallback when Haiku unavailable
- [x] Result sessions (max 5) with pill-tab UI to toggle between keyword and vibe searches
- [x] Drop-zone with drag / paste-URL / file-upload + reference strip
- [x] Vibe summary line shown above vibe-search results
- [x] Server-side resize (sharp) to stay under Anthropic's 5MB cap
- [x] Keychain-sourced API key + worktree-based rollback model

## Next steps (not started)

- [ ] Keyboard shortcuts (Del to delete, Esc to deselect, Ctrl+Z undo)
- [ ] Draggable panel resize (sidebar width)
- [ ] Multiple boards / board switcher
- [ ] Share board as URL (would need a backend)
- [ ] Mobile/touch support improvements
- [ ] Optional: CLIP visual-similarity re-rank on top of Haiku queries (Hybrid Approach C from the v2 design discussion)
