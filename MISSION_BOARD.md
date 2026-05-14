# MISSION BOARD — Moodboard Generator

**Brief:** Describe the vibe, drop in a reference image, OR dump a folder of your own images, get them curated and arranged on an interactive canvas, refine with AI clustering, export.

**Owner:** Sunny
**Started:** 2026-04-11
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · react-konva · JSZip · @anthropic-ai/sdk

## Versions

- **v1** (`v1-stable` tag · `63dc6d2`) — keyword search + canvas + 6 providers only. Pre-Haiku.
- **v2 baseline** (`stable-haiku-vibe` tag · `51477e5`) — Haiku-powered vibe reverse-search + text expansion merged to main.
- **v2 + uploads** (branch `feat/v2-uploads` at `~/projects/moodboard-generator-v2/`) — current development. Adds bring-your-own-images intake, AI cluster-on-canvas, multi-select, undo/redo. Runs on `:3002`. Mission Control Fleet owns `:3001`.

Rollback: `git reset --hard stable-haiku-vibe` returns to the merged Haiku baseline. `git reset --hard v1-stable` returns to the original pre-Haiku v1.

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
| 8 | Haiku vibe reverse-search + text expansion | done (v2 baseline, merged) |
| 9 | Uploads intake — folder/multi drop + My uploads tab + Mode A/B | done (v2-uploads) |
| 10 | Refine — cluster modal + Rejected tray + cost gate | done (v2-uploads) |
| 11 | "Add all to canvas" + find-similar on uploads | done (v2-uploads) |
| 12 | Cluster-on-canvas spatial rearrange + Cmd+Z undo/redo | done (v2-uploads) |
| 13 | Marquee + Cmd-click multi-select + multi-drag + Pan/Select tools | done (v2-uploads) |

## Phase 9-13 deliverables

### Intake (Phase 9)
- [x] `lib/upload-pool.ts` — useUploadPool hook, folder-drop file extraction (webkitGetAsEntry), auto-layout positions
- [x] In-memory blob URL pool (session-only; IndexedDB persistence parked in HQ BACKLOG 2026-05-14)
- [x] "My uploads" tab pinned to start of session row
- [x] Folder drop / multi-select picker; soft cap 50, hard cap 100, per-file 25MB
- [x] Mode A (drop on canvas → auto-layout) and Mode B (drop on panel → stage)
- [x] Find-similar Sparkles icon on uploaded thumbnails (routes through /api/similar with base64)

### Refine (Phase 10)
- [x] `app/api/cluster/route.ts` — POST endpoint; same image-prep pipeline as /api/similar
- [x] `lib/vision.ts` — `clusterByVibe()` Haiku tool-use returning 2-3 groups
- [x] `components/RefineModal.tsx` — cost / loading / result / error stages
- [x] `components/RejectedTray.tsx` — collapsible bottom dock, hover-to-restore
- [x] Cost confirmation gate ("about Xc") before any Haiku call
- [x] Soft reject (recoverable) — per the "soft" decision in scoping

### Polish (Phase 11)
- [x] "Add all to canvas" button on My uploads + search result session headers
- [x] Smart startY — new placements land below existing items, no overlap
- [x] Soft 50 / hard 100 image guardrails on upload pool

### Cluster on canvas + undo (Phase 12)
- [x] `lib/cluster-layout.ts` — pure layout fn, vertical columns with sub-grids
- [x] "Cluster on canvas" combined action — reject + spatial rearrange in one snapshot
- [x] Undo/Redo via Cmd+Z / Cmd+Shift+Z + toolbar icons
- [x] History capped at 30 snapshots, snapshots at discrete actions only

### Multi-select + lasso + tools (Phase 13)
- [x] `selectedIds: Set<string>` model + Konva multi-node Transformer
- [x] Lasso marquee on Select tool (partial intersect); Shift to add
- [x] Cmd-click toggle in/out of selection
- [x] Multi-drag — all selected move by leader's delta; snap on leader only; single history snapshot on dragend
- [x] Select / Pan toolbar icons; Spacebar hold = transient pan
- [x] V / H / Space keyboard shortcuts; Delete/Backspace removes all selected

## API keys

- `ANTHROPIC_API_KEY` — macOS Keychain entry `claude-mcp-anthropic-api-key`, pulled at `npm run dev` startup. No plaintext on disk.
- `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` — `.env.local` (symlinked from v1 worktree).

## Principles

- Server-side key handling only — keys never touch the client.
- Respect provider attribution requirements (show photographer credit on result cards).
- Free tier first. Haiku adds ~$0.001/vibe search, ~$0.0003/expansion, ~$0.04/refine for 30 images — negligible at realistic volume.
- localStorage persistence for board layout; in-memory only for uploads (Option A — IndexedDB upgrade in BACKLOG).
- Cache by content hash (SHA-256) — re-running the same source is free.
- Haiku failures degrade gracefully to rule-based expansion.
- Cost confirmation before any Haiku batch call.

## Open backlog (not started)

- IndexedDB persistence for uploaded image pool (HQ BACKLOG 2026-05-14 — tracked for future integration)
- Floating cluster labels on canvas (after Refine, display each cluster's name as a non-draggable Konva.Text)
- "Send all to canvas" with per-cluster grouping mode
- Draggable panel resize (sidebar width)
- Multiple boards / board switcher
- Share board as URL (needs a backend)
- Mobile/touch support improvements
- Optional: ranking results by CLIP visual similarity to source (Hybrid Approach C)
