import os from "node:os";
// Captures the inspiration sites listed in sites.json into mirrors/ (gitignored: third-party content).
// Per site: every response the browser received (HTML, CSS, JS, fonts, images) in a cache,
// a static snapshot of each rendered page (scripts removed), and desktop + mobile screenshots.
// Usage: node capture.mjs [siteId ...] [--headed]
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Outside the repo so every workspace reuses one capture (Kevin 2026-11-06: a fresh workspace re-captured for 10 min).
const MIRRORS = process.env.DUALIS_MIRRORS ?? path.join(os.homedir(), ".cache", "dualis-inspiration");
const MAX_PAGES = 6;
const args = process.argv.slice(2);
const headed = args.includes("--headed");
const only = args.filter((a) => !a.startsWith("--"));
const sites = JSON.parse(await readFile(path.join(ROOT, "sites.json"), "utf8")).filter(
  (s) => only.length === 0 || only.includes(s.id),
);

// Link picking: one page per category, best score first.
const CATEGORIES = [
  { key: "subscribe", re: /pric|subscri|plans?\b|membership|join|pledge/i },
  { key: "post", re: /\/p\/[^/]+$|\/research\/[^/]+$|\/insights?\/[^/]+$|\/notes?\/[^/]+$|\/blog\/[^/]+$|\/reports?\/[^/]+$/i },
  { key: "research", re: /research|archive|insights?|reports?|ideas|track|portfolio|strateg|blog/i },
  { key: "about", re: /about|team|firm|who-we-are|people|approach|philosophy/i },
  { key: "faq", re: /faq|contact/i },
];

export const cacheKey = (u) => {
  const url = new URL(u);
  return { host: url.host, file: createHash("sha1").update(url.pathname + url.search).digest("hex").slice(0, 16) };
};

async function saveResponse(siteDir, index, res) {
  const url = res.url();
  if (!/^https?:/.test(url) || index[url]) return;
  const st = res.status();
  if (st >= 300 && st < 400) return; // redirects carry no body; the target is captured on its own
  const body = await res.body().catch((e) => {
    console.warn(`[inspiration] body unavailable ${url}: ${e.message.split("\n")[0]}`);
    return null;
  });
  if (!body) return;
  const { host, file } = cacheKey(url);
  await mkdir(path.join(siteDir, "cache", host), { recursive: true });
  await writeFile(path.join(siteDir, "cache", host, file), body);
  index[url] = { host, file, status: st, type: res.headers()["content-type"] ?? "application/octet-stream" };
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

// Rendered DOM with every URL made absolute and scripts removed: the static version.
const snapshotDom = (page) =>
  page.evaluate(() => {
    const abs = (v) => {
      try { return new URL(v, document.baseURI).href; } catch { return v; }
    };
    for (const el of document.querySelectorAll("[src],[href],[poster],[data-src]")) {
      for (const a of ["src", "href", "poster", "data-src"]) {
        const v = el.getAttribute(a);
        if (v && !v.startsWith("#") && !v.startsWith("data:") && !v.startsWith("javascript:") && !v.startsWith("mailto:")) el.setAttribute(a, abs(v));
      }
    }
    for (const el of document.querySelectorAll("[srcset]")) {
      el.setAttribute("srcset", el.getAttribute("srcset").split(",").map((c) => {
        const [u, ...rest] = c.trim().split(/\s+/);
        return [abs(u), ...rest].join(" ");
      }).join(", "));
    }
    const fixCss = (css) => css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => (u.startsWith("data:") ? m : `url(${q}${abs(u)}${q})`));
    for (const el of document.querySelectorAll("[style]")) el.setAttribute("style", fixCss(el.getAttribute("style")));
    for (const el of document.querySelectorAll("style")) el.textContent = fixCss(el.textContent);
    for (const el of document.querySelectorAll("script, link[rel=preload][as=script], link[rel=modulepreload]")) el.remove();
    for (const el of document.querySelectorAll("img[loading=lazy]")) el.removeAttribute("loading");
    return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
  });

function pickLinks(links, home) {
  const origin = new URL(home);
  const base = origin.hostname.replace(/^www\./, "");
  const seen = new Set([origin.href.replace(/\/$/, "")]);
  const candidates = [];
  for (const href of links) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== base) continue;
    u.hash = "";
    const clean = u.href.replace(/\/$/, "");
    if (seen.has(clean) || /\.(pdf|png|jpe?g|zip)$/i.test(u.pathname) || /sign-?in|login|account|\/feed|\/comments?$|\/tos$|privacy|terms|cookie|legal|disclaimer/i.test(u.pathname)) continue;
    seen.add(clean);
    candidates.push(u.href);
  }
  const picked = [];
  for (const cat of CATEGORIES) {
    const hit = candidates.find((c) => !picked.some((p) => p.url === c) && cat.re.test(new URL(c).pathname));
    if (hit) picked.push({ url: hit, category: cat.key });
  }
  for (const c of candidates) {
    if (picked.length >= MAX_PAGES - 1) break;
    if (!picked.some((p) => p.url === c)) picked.push({ url: c, category: "other" });
  }
  return picked.slice(0, MAX_PAGES - 1);
}

const localPath = (u) => {
  const p = new URL(u).pathname.replace(/\/$/, "");
  return p === "" ? "/" : p;
};

async function captureSite(browser, site) {
  const siteDir = path.join(MIRRORS, site.id);
  await mkdir(path.join(siteDir, "static"), { recursive: true });
  await mkdir(path.join(siteDir, "shots"), { recursive: true });
  const index = {};
  const pages = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();
  const pending = new Set();
  page.on("response", (res) => {
    const p = saveResponse(siteDir, index, res);
    pending.add(p);
    p.finally(() => pending.delete(p));
  });

  const visit = async (url, category) => {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => console.log(`[inspiration] ${site.id} ${url}: network never idle, continuing`));
    const st = res?.status() ?? 0;
    const title = await page.title();
    if (st >= 400 || /just a moment|attention required|access denied/i.test(title)) {
      console.warn(`[inspiration] ${site.id} ${url}: blocked (HTTP ${st}, title "${title}")`);
      pages.push({ url, category, status: st, title, blocked: true });
      return null;
    }
    await scrollThrough(page);
    const lp = localPath(page.url());
    const html = await snapshotDom(page);
    const file = createHash("sha1").update(lp).digest("hex").slice(0, 16) + ".html";
    await writeFile(path.join(siteDir, "static", file), html);
    const shot = `${category}-desktop.png`;
    await page.screenshot({ path: path.join(siteDir, "shots", shot), fullPage: true });
    pages.push({ url: page.url(), finalPath: lp, category, status: st, title, static: file, shot });
    console.log(`[inspiration] ${site.id} ${category} ${page.url()} ok`);
    return page.url();
  };

  const homeUrl = await visit(site.home, "home");
  if (homeUrl) {
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href));
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(homeUrl, { waitUntil: "load", timeout: 60000 });
    await scrollThrough(mobile);
    await mobile.screenshot({ path: path.join(siteDir, "shots", "home-mobile.png"), fullPage: true });
    await mobile.close();
    const extra = (site.extra ?? []).map((p) => ({ url: new URL(p, homeUrl).href, category: p.replace(/^\//, "") }));
    for (const l of [...extra, ...pickLinks(links, homeUrl).filter((l) => !extra.some((e) => e.url === l.url))].slice(0, MAX_PAGES - 1 + extra.length)) {
      await visit(l.url, l.category).catch((e) => {
        console.warn(`[inspiration] ${site.id} ${l.url}: ${e.message.split("\n")[0]}`);
        pages.push({ url: l.url, category: l.category, error: e.message.split("\n")[0] });
      });
    }
  }
  await Promise.all(pending);
  await context.close();
  const meta = { ...site, origin: homeUrl ? new URL(homeUrl).origin : new URL(site.home).origin, capturedAt: new Date().toISOString(), pages };
  await writeFile(path.join(siteDir, "site.json"), JSON.stringify(meta, null, 2));
  await writeFile(path.join(siteDir, "index.json"), JSON.stringify(index));
  console.log(`[inspiration] ${site.id}: ${pages.filter((p) => p.static).length} pages, ${Object.keys(index).length} files`);
}

const browser = await chromium.launch({ channel: "chrome", headless: !headed, args: ["--disable-blink-features=AutomationControlled"] });
for (const site of sites) {
  await captureSite(browser, site).catch((e) => console.error(`[inspiration] ${site.id} failed: ${e.message}`));
}
await browser.close();
