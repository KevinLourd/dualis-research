# Console deploy (Dualis Hetzner server)

The console is a Next.js standalone Node server in the container `dualis-console` on the server `dualis-db`
(Thierry's Hetzner project, 46.225.102.182), next to Postgres. Moved off Cloudflare Workers on 2026-11-17: the free
plan allows 10 ms of CPU per request and an Analysis page costs 150-1,000 ms (pages died with error 1102).

- **Way in**: `console.dualisresearch.com` -> relay Worker on Thierry's Cloudflare (private repo `cloudflare/relay.js`)
  -> `https://console.46-225-102-182.sslip.io` -> Caddy (`/etc/caddy/Caddyfile`, Let's Encrypt, trusts Cloudflare's
  ranges so `X-Forwarded-Host` reaches Next and Clerk) -> `127.0.0.1:3000`. Port 3000 is closed to the internet (ufw
  + the Hetzner Cloud firewall).
- **Deploy**: `.github/workflows/deploy.yml` builds (`pnpm build`), packs `.next/standalone` + `.next/static` +
  `console.env` and pipes it over SSH as user `deploy`, whose key can only run `/srv/console/deploy-hook.sh`
  (this folder's `deploy-hook.sh`, copied there by hand with root). The hook unpacks a new release in
  `/srv/console/releases/`, restarts the container on it (`node:24-slim`, host network, 1 GB), checks `/sign-in`
  answers 200 and otherwise puts the previous release back. 3 releases kept.
- **Database**: `DATABASE_URL` = local (`127.0.0.1:5432`, no TLS); Postgres accepts it from the Docker gateway
  `172.17.0.1` only (`/srv/pg/pg_hba.conf`).
- **Logs**: `ssh root@46.225.102.182 docker logs --tail 100 dualis-console`.
- **Secrets** (repo): `CONSOLE_DEPLOY_KEY`, `CONSOLE_DEPLOY_HOST` (`deploy@46.225.102.182`),
  `CONSOLE_DEPLOY_KNOWN_HOSTS`; the runtime ones are written into `console.env` by the workflow.
