# Moodboard Generator

## Project

Interactive web app: describe a mood, drop in a reference image, OR dump a folder of your own images → arrange on a canvas with multi-select + lasso + AI clustering → export.

- **Repo:** https://github.com/SUNMANOFFICIAL189/moodboard-generator
- **Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · react-konva · puppeteer-core · JSZip · @anthropic-ai/sdk · zod · sharp (transitive)
- **Run:** `npm run dev` — port depends on version (see below)
- **Build:** `npm run build`

## Versions & worktree layout

| Version | Path | Branch | Port | Use it for |
|---|---|---|---|---|
| **v1** | `~/projects/moodboard-generator` | `main` | `:3000` | Now contains the merged Haiku baseline. Pre-Haiku v1 still recoverable via `v1-stable` tag. |
| **v2-uploads** | `~/projects/moodboard-generator-v2` | `feat/v2-uploads` | `:3002` | Current development. Uploads intake, AI cluster-on-canvas, multi-select, undo/redo, Pan/Select tools. |

Both share `.git` (worktree) and `.env.local` (symlink). `:3001` is taken by Mission Control Fleet — keep clear of it.

### Rollback model

Two named tags, two revert buttons:
- `v1-stable` → `63dc6d2`. The original pre-Haiku v1.
- `stable-haiku-vibe` → `51477e5`. The Haiku-merged baseline (`feat/v2-haiku-vibe` → `main`). Use this as the everyday revert target for uploads-feature work.

To roll back: `git reset --hard stable-haiku-vibe` (or `v1-stable` for the deeper revert). Branch `feat/v2-uploads` can be deleted entirely without affecting either tag.

## Architecture

```
app/
  page.tsx                — main layout: tool state, selection Set, modal wiring, keyboard shortcuts
  api/search/route.ts     — POST: Haiku expansion + 6-provider search (rule-based fallback)
  api/similar/route.ts    — POST: vibe extraction from image(s) → search
  api/cluster/route.ts    — POST: cluster N board images into 2-3 vibe groups (Refine)
  api/proxy/route.ts      — GET:  image proxy with host allowlist
components/
  SearchPanel.tsx         — prompt + provider toggles + vibe drop-zone + My uploads tab + session pills
  Canvas.tsx              — react-konva board; multi-select, marquee lasso, multi-drag, Pan/Select tools
  RefineModal.tsx         — Refine cost gate / loading / cluster-pick / error stages
  RejectedTray.tsx        — collapsible bottom dock for soft-rejected items
lib/
  vision.ts               — Haiku 4.5: extractVibe(), expandPromptWithHaiku(), clusterByVibe()
  image-cache.ts          — in-memory LRU keyed by SHA-256 of content
  upload-pool.ts          — useUploadPool() hook + folder-drop extraction + autoLayoutPositions()
  cluster-layout.ts       — pure fn: VibeCluster[] + BoardItems → per-id placement (cluster columns)
  providers/              — unsplash.ts, pexels.ts, pixabay.ts, pinterest.ts, arena.ts, cosmos.ts, index.ts
  store.ts                — useBoard(): items + rejected + history/future stacks + undo/redo
  expand.ts               — rule-based query expansion (fallback when Haiku unavailable)
  export.ts               — ZIP (with CREDITS.md) + PNG canvas snapshot
  types.ts                — Provider, ImageResult, BoardItem, VibePayload, VibeCluster, UploadedImage, ...
  utils.ts                — cn(), uid(), proxied() (passes blob:/data: through unchanged)
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

## Vibe search

Three entry points trigger a Haiku vision call:

1. **Sparkles icon** on any result card → that image joins the reference strip.
2. **Sparkles icon** on any My-uploads thumbnail → reverse-search from your own image.
3. **Drop-zone** under the prompt input → drag image, click Upload, or paste an image URL.

Up to **3 reference images** can be combined — Haiku extracts the *intersection* vibe. Payload (domain, mood, palette, materials/lens, subjects, queries) is cached by SHA-256 of the source bytes; re-running the same source is free.

## My uploads (Phase 9-11)

Bring your own pool of images into the workspace.

- **Folder drop** (Chrome/Safari) or **multi-select picker** via the "Add images" / "Add folder" buttons on the My uploads tab.
- **Drop target decides mode:**
  - Drop on canvas → Mode A: auto-layout grid at the drop point, also added to the pool.
  - Drop on the My uploads tab area → Mode B: pool only, no canvas placement yet.
- Caps: soft 50 (warning banner), hard 100 (block), per-file 25MB, all resized to 1568px@0.92 JPEG on intake.
- Storage: **in-memory blob URLs only**. Session-scoped — refresh wipes uploads. IndexedDB persistence parked in HQ BACKLOG (2026-05-14).
- **Add all N to canvas** button on the My uploads tab → batch place every upload in a packed grid below existing items.
- **Find similar** Sparkles icon on each upload thumbnail → reverse-search via `/api/similar` with a base64 payload.
- **Cluster on canvas** (Refine vibe modal) → Haiku groups N board images into 2-3 vibe clusters; rejected clusters move to a soft Rejected tray; kept clusters get spatially arranged on the canvas as vertical columns.

## Tools and selection (Phase 13)

- **Select tool (V, default)** — click image to select, Cmd-click to toggle multi-select, drag from empty canvas for lasso marquee (Shift to add).
- **Pan tool (H)** — drag empty canvas to pan.
- **Spacebar (hold)** — transient pan; release returns to Select.
- **Multi-drag** — all selected items move together by the leader's delta. Snap only fires on the leader.
- **Backspace/Delete** — removes all selected.
- **Cmd+Z / Cmd+Shift+Z** — undo/redo. History capped at 30 entries; snapshots taken at discrete actions only (add, batch-add, delete, refine apply, restore, clear, cluster rearrange, multi-drag commit).

### Result sessions

Each search action — keyword OR vibe — creates a new **session** (max 5, oldest evicted). Pill tabs above the results let you toggle between sessions. Vibe sessions show a violet "Vibe" summary line above their results. The "My uploads" tab is pinned to the start of the row.

## Key design decisions

- Server-side key handling only — `ANTHROPIC_API_KEY` and provider keys never reach the client.
- `/api/proxy`, `/api/similar`, and `/api/cluster` share the same image-host allowlist (Unsplash, Pexels, Pixabay, Pinterest CDN, Are.na, Cosmos.so).
- Pinterest provider launches a shared headless Chrome instance (pooled, not per-request).
- Grid snap: 10px gap between edges, also snaps to alignment (left/right/top/bottom/center), 12px threshold. Snap fires on single-drag and on the leader of a multi-drag only.
- `proxied()` passes blob:/data: URLs through unchanged (proxying them would 403 against the host allowlist).
- `useImage(src, crossOrigin)` skips crossOrigin for blob:/data: URLs — setting `"anonymous"` on a same-origin blob silently taints the load in Chrome and renders the KImage blank.
- Blob URL lifecycle: revoked only on explicit remove/clear, NEVER on hook unmount. StrictMode's mount→unmount→mount cycle would otherwise revoke URLs that live state still references.
- localStorage for board persistence; in-memory only for uploads (Option A; IndexedDB upgrade in HQ BACKLOG).
- Cost confirmation gate appears before any Haiku batch call (Refine cluster) — `lazy` tagging on intake means uploads cost $0 until Refine is invoked.
- Refine combines reject + spatial rearrange in ONE undoable snapshot.
- Haiku failures degrade gracefully to rule-based expansion — Haiku is a quality upgrade, not a hard dependency.
- Server-side `sharp` resizes any image >4MB to max 1568px JPEG before sending to Anthropic vision (5MB API limit). Client-side resize on uploads to 1568px@0.92 before send.

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

### v2 baseline (tag `stable-haiku-vibe`, commit `51477e5`)
- [x] Haiku 4.5 client (`lib/vision.ts`) with forced tool-use + Zod validation
- [x] Domain-aware vibe extraction (architecture / interior / photo / graphic / fashion / nature / abstract / object)
- [x] Multi-image intersection vibe (up to 3 references)
- [x] `/api/similar` endpoint with content-hash caching
- [x] Haiku-powered text expansion
- [x] Rule-based fallback when Haiku unavailable
- [x] Result sessions (max 5) with pill-tab UI
- [x] Drop-zone with drag / paste-URL / file-upload + reference strip
- [x] Vibe summary line shown above vibe-search results
- [x] Server-side resize (sharp) to stay under Anthropic's 5MB cap
- [x] Keychain-sourced API key + worktree-based rollback model
- [x] Merged to `main` and tagged `stable-haiku-vibe`

### v2 + uploads (branch `feat/v2-uploads`)
- [x] **Phase 9 — Intake:** folder drop, multi-select picker, My uploads tab, Mode A (canvas drop = auto-layout) + Mode B (panel drop = stage); soft 50 / hard 100 caps
- [x] **Phase 10 — Refine:** `/api/cluster` route + `clusterByVibe()` + RefineModal with cost gate + soft Rejected tray
- [x] **Phase 11 — Polish:** "Add all N to canvas" buttons + find-similar on uploaded thumbs + smart startY layout
- [x] **Phase 12 — Cluster on canvas + Undo:** spatial cluster rearrange combined with reject in a single undoable snapshot; Cmd+Z / Cmd+Shift+Z + toolbar Undo/Redo icons; history cap 30
- [x] **Phase 13 — Multi-select + tools:** lasso marquee, Cmd-click toggle, multi-drag with leader delta, Konva multi-node Transformer, Select/Pan toolbar icons + V/H/Space keyboard shortcuts

## Next steps (not started)

- [ ] IndexedDB persistence for uploads (HQ BACKLOG 2026-05-14)
- [ ] Floating cluster labels on canvas (post-Refine)
- [ ] Draggable panel resize (sidebar width)
- [ ] Multiple boards / board switcher
- [ ] Share board as URL (would need a backend)
- [ ] Mobile/touch support improvements
- [ ] Optional: CLIP visual-similarity re-rank on top of Haiku queries (Hybrid Approach C)
