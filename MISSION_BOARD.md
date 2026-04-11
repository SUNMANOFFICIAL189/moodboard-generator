# MISSION BOARD — Moodboard Generator

**Brief:** Describe the vibe, get curated images from Unsplash + Pexels + Pixabay, drop them on an interactive canvas, rearrange, export.

**Owner:** Sunny
**Started:** 2026-04-11
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · react-konva · JSZip

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + env | done |
| 2 | Provider library (Unsplash / Pexels / Pixabay) | pending |
| 3 | API routes (search, expand) | pending |
| 4 | Search UI + results grid | pending |
| 5 | Canvas (react-konva) | pending |
| 6 | Export (ZIP + PNG) | pending |
| 7 | Polish + verify | pending |

## API Keys required

Populate `.env.local`:

- `UNSPLASH_ACCESS_KEY` — https://unsplash.com/developers (free, demo = 50 req/hr)
- `PEXELS_API_KEY` — https://www.pexels.com/api/ (free, 200 req/hr)
- `PIXABAY_API_KEY` — https://pixabay.com/api/docs/ (free, 100 req/min)

App runs without keys (falls back to empty results per missing provider) so you can try the canvas with sample images.

## Principles

- Server-side key handling only — keys never touch the client.
- Respect provider attribution requirements (show photographer credit).
- Free tier first. No paid services.
- localStorage persistence, no backend DB in v1.
