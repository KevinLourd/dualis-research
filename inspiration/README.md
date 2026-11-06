# Inspiration sites (local copies)

Local copies of the sites Thierry cited (`docs/references.md`) plus his current Duality Fund site, to study their UI/UX before we build the Dualis Research website.

```bash
cd inspiration
pnpm install
node capture.mjs            # every site in sites.json (or: node capture.mjs pernas citrini)
node serve.mjs              # then open http://inspo.localhost:4400/
```

| URL | What |
|---|---|
| `inspo.localhost:4400` | Index: every site, its captured pages, desktop + mobile screenshots |
| `<id>.localhost:4400` | Live copy: the original HTML **with its JavaScript** (animations, menus), assets served from the local cache; anything not captured is fetched from the real site |
| `<id>-static.localhost:4400` | Frozen snapshot of the rendered page, no JS (fallback when a site's JS breaks off its domain) |

`*.localhost` resolves to your machine in Chrome and Safari, no `/etc/hosts` edit.

- Capture = real Chrome (Playwright, `channel: "chrome"`): home + up to 5 key pages per site (subscribe/pricing, one post, research/archive, about, FAQ), picked from the home page links. A site blocking headless Chrome: `node capture.mjs <id> --headed`.
- Captures live in `~/.cache/dualis-inspiration` (override `DUALIS_MIRRORS`), outside the repo: third-party content never enters git (this repo is public and goes to Thierry), and every workspace reuses one capture instead of re-capturing. Re-capture only a site that changed: `node capture.mjs <id>`.
- Add a site: one line in `sites.json` (`id` = the subdomain).
