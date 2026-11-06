import os from "node:os";
// Serves the captured sites on local subdomains (port 4400 by default):
//   inspo.localhost:4400          index of every site, with screenshots
//   <id>.localhost:4400           live copy: original HTML + JS, assets from the local cache,
//                                 anything not captured is fetched from the real site
//   <id>-static.localhost:4400    frozen snapshot of the rendered page, no JS
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Outside the repo so every workspace reuses one capture (Kevin 2026-11-06: a fresh workspace re-captured for 10 min).
const MIRRORS = process.env.DUALIS_MIRRORS ?? path.join(os.homedir(), ".cache", "dualis-inspiration");
const PORT = Number(process.env.PORT ?? 4400);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

async function loadSites() {
  const sites = {};
  if (!existsSync(MIRRORS)) return sites;
  for (const id of await readdir(MIRRORS)) {
    const metaFile = path.join(MIRRORS, id, "site.json");
    if (!existsSync(metaFile)) continue;
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    const index = JSON.parse(await readFile(path.join(MIRRORS, id, "index.json"), "utf8"));
    const hosts = [...new Set(Object.values(index).map((e) => e.host))];
    sites[id] = { meta, index, hosts, originHost: new URL(meta.origin).host };
  }
  return sites;
}

const isText = (type) => /text\/|javascript|json|svg|xml/.test(type);

// Absolute URLs become local: the site's own host -> "/", any other captured host -> "/_x/<host>/".
function rewrite(site, text, { stripIntegrity }) {
  let out = text;
  for (const host of site.hosts) {
    const target = host === site.originHost ? "" : `/_x/${host}`;
    const esc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`https?:\\/\\/${esc}`, "g"), target)
      .replace(new RegExp(`https?:\\\\/\\\\/${esc.replace(/\//g, "\\\\/")}`, "g"), target.replace(/\//g, "\\/"))
      .replace(new RegExp(`(["'(])\\/\\/${esc}`, "g"), `$1${target}`);
  }
  if (stripIntegrity) out = out.replace(/\sintegrity=("[^"]*"|'[^']*')/g, "").replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, "");
  return out;
}

function lookup(site, absUrl) {
  const candidates = [absUrl, absUrl.endsWith("/") ? absUrl.slice(0, -1) : absUrl + "/"];
  for (const c of candidates) if (site.index[c]) return site.index[c];
  return null;
}

async function sendCached(res, site, entry, { live }) {
  const body = await readFile(path.join(MIRRORS, site.meta.id, "cache", entry.host, entry.file));
  const type = entry.type;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  if (isText(type)) {
    res.end(rewrite(site, body.toString("utf8"), { stripIntegrity: live && type.includes("html") }));
  } else res.end(body);
}

async function proxy(res, site, absUrl) {
  const upstream = await fetch(absUrl, { headers: { "user-agent": UA }, redirect: "follow" });
  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await upstream.arrayBuffer());
  console.log(`[inspiration] ${site.meta.id} live ${upstream.status} ${absUrl}`);
  res.statusCode = upstream.status;
  res.setHeader("content-type", type);
  res.end(isText(type) ? rewrite(site, buf.toString("utf8"), { stripIntegrity: type.includes("html") }) : buf);
}

async function serveSite(req, res, site, staticMode) {
  const url = new URL(req.url, "http://x");
  let absUrl;
  if (url.pathname.startsWith("/_x/")) {
    const [, , host, ...rest] = url.pathname.split("/");
    absUrl = `https://${host}/${rest.join("/")}${url.search}`;
  } else {
    absUrl = `${site.meta.origin}${url.pathname}${url.search}`;
  }
  if (staticMode && !url.pathname.startsWith("/_x/")) {
    const p = url.pathname.replace(/\/$/, "") || "/";
    const page = site.meta.pages.find((pg) => pg.finalPath === p && pg.static);
    if (page) {
      const html = await readFile(path.join(MIRRORS, site.meta.id, "static", page.static), "utf8");
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(rewrite(site, html, { stripIntegrity: true }));
    }
  }
  const entry = lookup(site, absUrl);
  if (entry) return sendCached(res, site, entry, { live: !staticMode });
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("read-only copy");
  }
  return proxy(res, site, absUrl);
}

function indexPage(sites) {
  const cards = Object.values(sites).map(({ meta }) => {
    const pages = meta.pages.map((p) => p.static
      ? `<li><a href="http://${meta.id}.localhost:${PORT}${p.finalPath}">${p.category}</a> <span>${p.finalPath}</span> <a class="s" href="http://${meta.id}-static.localhost:${PORT}${p.finalPath}">static</a> <a class="s" href="/shots/${meta.id}/${p.shot}">screenshot</a></li>`
      : `<li class="bad">${p.category} ${p.url}: ${p.blocked ? `blocked (HTTP ${p.status})` : p.error}</li>`).join("");
    const home = meta.pages.find((p) => p.category === "home" && p.static);
    return `<article><a href="http://${meta.id}.localhost:${PORT}/"><img src="/shots/${meta.id}/home-desktop.png" alt=""></a>
      <h2><a href="http://${meta.id}.localhost:${PORT}/">${meta.name}</a></h2><p>${meta.why} · <a href="${meta.origin}">${meta.origin.replace("https://", "")}</a>${home ? "" : " · <b>home not captured</b>"}</p><ul>${pages}</ul>
      <a class="s" href="/shots/${meta.id}/home-mobile.png">mobile screenshot</a></article>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dualis inspiration</title><style>
    body{font:14px/1.5 system-ui;margin:32px;background:#f6f7f9;color:#0b1b33}h1{margin:0 0 24px}
    main{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}
    article{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:14px}
    article img{width:100%;height:240px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid #eee}
    h2{font-size:16px;margin:10px 0 2px}a{color:#0b3d91}p{margin:0 0 8px;color:#5b6575}ul{padding-left:18px;margin:6px 0}
    li span{color:#8a93a3}.s{font-size:12px;color:#8a93a3}.bad{color:#b42318}</style></head>
    <body><h1>Dualis Research: inspiration sites</h1><main>${cards}</main></body></html>`;
}

createServer(async (req, res) => {
  const sites = await loadSites();
  const sub = (req.headers.host ?? "").split(":")[0].replace(/\.localhost$/, "");
  try {
    if (sub === "inspo" || sub === "localhost") {
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/shots/")) {
        const [, , id, file] = url.pathname.split("/");
        res.setHeader("content-type", "image/png");
        return res.end(await readFile(path.join(MIRRORS, id, "shots", path.basename(file))));
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(indexPage(sites));
    }
    const staticMode = sub.endsWith("-static");
    const site = sites[staticMode ? sub.slice(0, -"-static".length) : sub];
    if (!site) {
      res.statusCode = 404;
      return res.end(`unknown site "${sub}". Open http://inspo.localhost:${PORT}/`);
    }
    await serveSite(req, res, site, staticMode);
  } catch (e) {
    console.error(`[inspiration] ${req.headers.host}${req.url}: ${e.message}`);
    res.statusCode = 502;
    res.end(e.message);
  }
}).listen(PORT, () => console.log(`[inspiration] http://inspo.localhost:${PORT}/`));
