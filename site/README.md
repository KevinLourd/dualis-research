# Dualis Research website (`site/`)

The public website, a near copy of Aurelion Research's layout (Kevin 2026-11-05): Home (hero), Company, Research (with the research portal), Portfolio, About, Contact, Plans, Disclaimer. Private preview for Thierry until launch (not indexed, no link to it anywhere).

- Live: https://dualis-site.dualis-research.workers.dev (every merge to `main` touching `site/` deploys, `.github/workflows/deploy-site.yml`).
- Data: reads the console's **gold** tables in Neon, read-only (`src/lib/queries.ts`): only Thierry's PUBLISHED Substack articles (`gold.content_library`, own publications) and his Substack URL (`gold.content_channels`). Never the watchlist, theses or calls.
- Portal shelves (Coverage / Primers / Memos) come from `research_category`, judged once per post by the console's `content-posts` collector. A post not judged yet shows under All only.
- Covers: drawn from the post (seeded constellation, shelf, title, date), `src/components/cover.tsx`. Never AI images.
- Portfolio: year-to-date figure from `TRACK_RECORD` in `src/lib/model.ts` (Thierry's published number; replace with the brokerage statement). Prices: `PLANS`.
- Motion: home = one screen with a live constellation reacting to the mouse (`hero-field.tsx`); every section animates in on scroll (`reveal.tsx`). Off under reduced motion.
- Look: `design/` tokens (navy base, purple accent, dark charts in `dark-chart.tsx`), Newsreader + IBM Plex.

```bash
pnpm install
DATABASE_URL=postgres://... pnpm dev   # http://localhost:3100
pnpm test && pnpm typecheck
```
