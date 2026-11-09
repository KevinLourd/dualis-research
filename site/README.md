# Dualis Research website (`site/`)

The public website: Aurelion Research's page list (Kevin 2026-11-05), none of its blocks (Kevin 2026-11-06): Home (video hero), Company, Research (with the research portal), Portfolio, About, Contact, Subscribe (the plans, `/subscribe`), Disclaimer, Terms of Use, Privacy Policy. Private preview for Thierry until launch (not indexed, no link to it anywhere).

- Live: https://dualis-site.dualis-research.workers.dev (every merge to `main` touching `site/` deploys, `.github/workflows/deploy-site.yml`).
- Data: reads the console's **gold** tables in Neon, read-only (`src/lib/queries.ts`): only Thierry's PUBLISHED Substack articles (`gold.content_library`, own publications) and his Substack URL (`gold.content_channels`). Never the watchlist, theses or calls.
- Portal shelves (Coverage / Primers / Memos) come from `research_category`, judged once per post by the console's `content-posts` collector. A post not judged yet shows under All only.
- Covers: a Wikimedia Commons photo of the company or its industry (`cover_photo_*` in `gold.content_library`, picked once per post by the console's `cover-photos` collector) under an indigo veil, with shelf, title, date and mark, `src/components/cover.tsx`. Plain indigo until a photo is picked. Never AI images. Research page: a black strip of covers in black and white; hover grows one and turns it to colour.
- Track record: year-to-date figure from `TRACK_RECORD` in `src/lib/model.ts` (Thierry's published number; replace with the brokerage statement) and his post's curve vs the S&P 500, digitised in `src/lib/track-record.ts`. Prices: `PLANS`.
- Motion: none, except the cover strip's hover (Thierry 2026-11-06) and the home video (Kevin 2026-11-06, `public/video/hero.mp4`, Mixkit free licence, poster on reduced motion). Home = one screen.
- Look: `design/` tokens (Dualis indigo `#2B2463`, deep bands `#1A1640` with white type, no light purple; light charts in `dark-chart.tsx` / `ytd-chart.tsx`: white panel, Dualis indigo line, grey S&P 500), Newsreader for statements, IBM Plex Sans for section headings and interface.
- Copy guard: `src/lib/copy.test.ts` (no fund wording, no portfolio size, no light purple, no Aurelion lines).

```bash
pnpm install
DATABASE_URL=postgres://... pnpm dev   # http://localhost:3100
pnpm test && pnpm typecheck
```
