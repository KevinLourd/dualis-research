# Dualis Research website (`site/`)

The public website: Aurelion Research's pages and order (Kevin 2026-11-05), its own rendering (Thierry 2026-11-06): Home (hero), Company, Research (with the research portal), Portfolio, About, Contact, Plans, Disclaimer. Private preview for Thierry until launch (not indexed, no link to it anywhere).

- Live: https://dualis-site.dualis-research.workers.dev (every merge to `main` touching `site/` deploys, `.github/workflows/deploy-site.yml`).
- Data: reads the console's **gold** tables in Neon, read-only (`src/lib/queries.ts`): only Thierry's PUBLISHED Substack articles (`gold.content_library`, own publications) and his Substack URL (`gold.content_channels`). Never the watchlist, theses or calls.
- Portal shelves (Coverage / Primers / Memos) come from `research_category`, judged once per post by the console's `content-posts` collector. A post not judged yet shows under All only.
- Covers: a Wikimedia Commons photo of the company or its industry (`cover_photo_*` in `gold.content_library`, picked once per post by the console's `cover-photos` collector) under an indigo veil, with shelf, title, date and mark, `src/components/cover.tsx`. Plain indigo until a photo is picked. Never AI images. Research page: a black strip of covers in black and white; hover grows one and turns it to colour.
- Portfolio: year-to-date figure from `TRACK_RECORD` in `src/lib/model.ts` (Thierry's published number; replace with the brokerage statement). Prices: `PLANS`.
- Motion: none, except the cover strip's hover (Thierry 2026-11-06). Home = one screen, constellation drawn still.
- Look: `design/` tokens (one colour, Dualis indigo `#2B2463`; dark charts in `dark-chart.tsx`), Newsreader for statements, IBM Plex Sans for section headings and interface.

```bash
pnpm install
DATABASE_URL=postgres://... pnpm dev   # http://localhost:3100
pnpm test && pnpm typecheck
```
