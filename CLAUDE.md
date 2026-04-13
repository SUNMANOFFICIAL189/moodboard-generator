# Moodboard Generator

## Project

Interactive web app: describe a mood → pull images from 4 providers → arrange on a canvas → export.

- **Repo:** https://github.com/SUNMANOFFICIAL189/moodboard-generator
- **Stack:** Next.js 16 · TypeScript · Tailwind v4 · react-konva · puppeteer-core · JSZip
- **Run:** `npm run dev` (default port 3000)
- **Build:** `npm run build`

## Architecture

```
app/
  page.tsx              — main layout: sidebar search + canvas
  api/search/route.ts   — POST: merges 4 providers, query expansion
  api/proxy/route.ts    — GET: image proxy with host allowlist
components/
  SearchPanel.tsx       — prompt input, provider toggles, results grid, clear results
  Canvas.tsx            — react-konva board: drag/resize/rotate/pan/zoom, grid snap (10px gap)
lib/
  providers/            — unsplash.ts, pexels.ts, pixabay.ts, pinterest.ts, index.ts
  store.ts              — useBoard() hook, localStorage persistence
  expand.ts             — rule-based query expansion (splits prompt → 3-5 sub-queries)
  export.ts             — ZIP (with CREDITS.md) + PNG canvas snapshot
  types.ts              — Provider, ImageResult, BoardItem
  utils.ts              — cn(), uid(), proxied()
```

## Image Providers

| Provider | Auth | Notes |
|----------|------|-------|
| Unsplash | `UNSPLASH_ACCESS_KEY` in `.env.local` | Free, 50 req/hr demo |
| Pexels | `PEXELS_API_KEY` in `.env.local` | Free, 200 req/hr |
| Pixabay | `PIXABAY_API_KEY` in `.env.local` | Free, 100 req/min |
| Pinterest | None — uses local Chrome via puppeteer-core | Headless scrape, graceful fallback |

App works with any subset of keys. Pinterest needs Chrome at `/Applications/Google Chrome.app/`.

## Key Design Decisions

- Server-side key handling only — API keys never reach the client
- `/api/proxy` allowlists specific image CDN hosts (images.unsplash.com, images.pexels.com, cdn.pixabay.com, i.pinimg.com)
- Pinterest provider launches a shared headless Chrome instance (pooled, not per-request)
- Grid snap: 10px gap between edges, also snaps to alignment (left/right/top/bottom/center), 12px threshold
- localStorage for board persistence, no backend DB in v1
- `_API/` and `_TERMINAL_SCRIPT/` are gitignored (contain local credentials)

## Knowledge Layer Links

- **Obsidian:** `~/Vaults/Jarvis-Brain/JARVIS-BRAIN/Moodboard Generator.md`
- **Auto-memory:** `~/.claude/projects/-Users-sunil-rajput-claude-hq/memory/project_moodboard_generator.md`
- **claude-mem:** Observations auto-captured (search "moodboard generator")
- **MISSION_BOARD.md:** In project root — phase tracker

## What's Done (v1)

- [x] 4-provider parallel image search with query expansion
- [x] Search UI with provider toggles + clear results
- [x] Interactive canvas (drag/resize/rotate/pan/zoom/z-order)
- [x] Grid snap system (10px gap, toggleable)
- [x] Export: ZIP with CREDITS.md + PNG snapshot
- [x] localStorage board persistence
- [x] GitHub repo created and pushed

## Next Steps (not started)

- [ ] Keyboard shortcuts (Del to delete, Esc to deselect, Ctrl+Z undo)
- [ ] Haiku-powered query expansion for richer variety
- [ ] Draggable panel resize (sidebar width)
- [ ] Multiple boards / board switcher
- [ ] Share board as URL (would need a backend)
- [ ] Mobile/touch support improvements
