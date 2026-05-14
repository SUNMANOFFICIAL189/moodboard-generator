# MISSION BOARD — Moodboard Generator

**Brief:** Describe the vibe (or drop in a reference image), get curated images from 6 providers, drop them on an interactive canvas, rearrange, export.

**Owner:** Sunny
**Started:** 2026-04-11
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · react-konva · JSZip · @anthropic-ai/sdk

## Versions

- **v1** (`v1-stable` tag · `63dc6d2`) — keyword search + canvas + 6 providers. Runs on `:3000`.
- **v2** (branch `feat/v2-haiku-vibe` at `~/projects/moodboard-generator-v2/`) — adds Haiku-powered vibe reverse-search and richer text expansion. Runs on `:3002`. Mission Control Fleet owns `:3001`.

Rollback: see CLAUDE.md → "Worktree + rollback model".

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + env | done (v1) |
| 2 | Provider library (Unsplash / Pexels / Pixabay) | done (v1) |
| 3 | API routes (search, proxy) | done (v1) |
| 4 | Search UI + results grid | done (v1) |
| 5 | Canvas (react-konva) | done (v1) |
| 6 | Export (ZIP + PNG) | done (v1) |
| 7 | Grid snap + Pinterest + Are.na + Cosmos | done (v1) |
| 8 | Haiku vibe reverse-search + text expansion | done (v2) |

## Phase 8 deliverables (v2)

- [x] `lib/vision.ts` — Haiku 4.5 client with forced tool-use (typed VibePayload)
- [x] `lib/image-cache.ts` — in-memory LRU keyed by content hash
- [x] `app/api/similar/route.ts` — POST endpoint accepting URLs / base64 / multi-image
- [x] `app/api/search/route.ts` — upgraded with Haiku expansion + rule-based fallback
- [x] SearchPanel — drop-zone, reference strip, find-similar icons, session tabs, vibe summary
- [x] Server-side resize (sharp) for oversized images to stay under Anthropic's 5MB cap
- [x] Keychain-sourced `ANTHROPIC_API_KEY` (no plaintext on disk)
- [x] v1-stable rollback tag + git worktree for parallel run

## API keys (v2 additions)

- `ANTHROPIC_API_KEY` — sourced from macOS Keychain entry `claude-mcp-anthropic-api-key`. Pulled at `npm run dev` startup. **No plaintext copy on disk.** If you ever need to add a new one: `security add-generic-password -U -a "$USER" -s claude-mcp-anthropic-api-key -w <KEY>`.

Existing provider keys (`UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`) still live in `.env.local`. The v2 worktree shares v1's `.env.local` via symlink.

## Principles

- Server-side key handling only — keys never touch the client.
- Respect provider attribution requirements (show photographer credit).
- Free tier first. Haiku adds ~$0.001 per vibe search, ~$0.0003 per text expansion — negligible at any realistic volume.
- localStorage persistence, no backend DB.
- Cache by content hash (SHA-256) — re-running the same source is free.
- Haiku failures degrade gracefully to rule-based expansion (no user-facing downtime if the API hiccups).

## Open backlog (not started)

- Keyboard shortcuts (Del / Esc / Ctrl+Z) — parked from v1
- Draggable panel resize (sidebar width)
- Multiple boards / board switcher
- Share board as URL (would need a backend)
- Mobile/touch support improvements
- Optional: ranking results by CLIP visual similarity to the source image (Hybrid Approach C from the design discussion)
