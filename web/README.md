# web: Dualis Research console

Next.js 15 + Kumo (Cloudflare's dashboard components), a Node server on the Dualis Hetzner server (`deploy/README.md`), Postgres, Clerk login.
Conventions (bronze/silver/gold, collector runner, LLM helper, adding a dimension): see the root `CLAUDE.md`.

## Commands
```bash
pnpm install
pnpm test            # vitest on in-process Postgres (PGlite): no Docker, no network
pnpm typecheck && pnpm lint
pnpm db:generate --name <change>   # after editing src/db/schema/*
pnpm db:migrate      # DATABASE_URL_UNPOOLED or DATABASE_URL
pnpm collect all     # or one dimension: watchlist, company-profile
pnpm build           # standalone Node server (.next/standalone), deployed by deploy.yml
```

## Environments
- **Production**: every merge to `main` runs `.github/workflows/deploy.yml` (needs repo secrets `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CONSOLE_DEPLOY_KEY`, `CONSOLE_DEPLOY_HOST`, `CONSOLE_DEPLOY_KNOWN_HOSTS`; the job names any missing one). Collectors: `.github/workflows/collect.yml` (daily + manual), keys `FMP_API_KEY`, `FINNHUB_API_KEY`, `CLAUDE_OAUTH_TOKEN`...
- **Local UI work**: point `DATABASE_URL` at a Neon branch (`neon.ts`: non-default branches expire after 7 days). For screenshots without Clerk keys: `SCREENSHOT_AUTH_STUB=1 pnpm dev` (dev only, stubs Clerk via a webpack alias in `next.config.ts`; never in a build).
