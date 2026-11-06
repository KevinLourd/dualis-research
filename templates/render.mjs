#!/usr/bin/env node
// Dualis Research: render the Substack images of one article.
//
//   node templates/render.mjs templates/example/spec.json
//
// Reads the spec, builds one HTML page per image (design tokens + design/components/bundle.css
// + templates/images.css), then screenshots each page with headless Chrome at 1456px wide
// (Substack's full-width image size). No npm dependencies. Falls back to qlmanage if Chrome fails.
//
// Image types: header, bullbear, scenarios, chart. See templates/README.md for the spec format.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Layout width in CSS px. Images are rendered at OUT_W physical px, so text keeps a readable
// size once Substack shrinks the image to a phone screen.
const CSS_W = 560;
const OUT_W = 1456;
const SCALE = OUT_W / CSS_W;

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stripDashes = (s) => String(s ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ");
const t = (s) => esc(stripDashes(s));

function tokensCss(theme = "light") {
  const tok = JSON.parse(readFileSync(join(ROOT, "design/tokens.json"), "utf8"));
  const lines = [];
  for (const c of tok.color.tokens) lines.push(`--${c.name}: ${c.value[theme]};`);
  for (const [k, v] of Object.entries(tok.type.families)) lines.push(`--font-${k}: ${v};`);
  for (const s of tok.spacing.tokens) lines.push(`--${s.name}: ${s.value};`);
  for (const r of tok.radius.tokens) lines.push(`--${r.name}: ${r.value};`);
  return `:root{${lines.join("")}}`;
}

function logoSvg(name = "split-disc") {
  const p = join(ROOT, "design/assets/Logos", `${name}.svg`);
  return readFileSync(p, "utf8").replace(/#2b2463/gi, "currentColor");
}

function page(body, spec) {
  const bundle = pathToFileURL(join(ROOT, "design/components/bundle.css")).href;
  const images = pathToFileURL(join(HERE, "images.css")).href;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${tokensCss()}</style>
<link rel="stylesheet" href="${bundle}"><link rel="stylesheet" href="${images}">
</head><body><div class="frame" id="frame">${body}${footer(spec)}</div>
<script>
document.fonts.ready.then(() => {
  const h = Math.ceil(document.getElementById("frame").getBoundingClientRect().height);
  document.body.setAttribute("data-h", String(h));
});
</script></body></html>`;
}

function footer(spec) {
  const a = spec.article;
  const right = [a.ticker && `${a.ticker}`, a.date].filter(Boolean).map(t).join(" &middot; ");
  const example = a.example ? `<span class="example">EXAMPLE, not a real company</span>` : "";
  return `<footer class="foot"><span class="mark">${logoSvg(spec.logo)}</span><span class="word">DUALIS RESEARCH</span>${example}<span class="right">${right}</span></footer>`;
}

const kicker = (label, title) =>
  `<div class="kicker"><span class="dr-label">${t(label)}</span>${title ? `<h2>${t(title)}</h2>` : ""}</div>`;

// ---------- image types ----------
function header(img, spec) {
  const a = spec.article;
  const pos = (a.position || "LONG").toUpperCase();
  const upside = String(a.upside ?? "");
  const upCls = upside.trim().startsWith("-") ? "down" : "up";
  const cells = [
    ["Ticker", `<span class="dr-fig ticker">${t(a.ticker)} &middot; ${t(a.exchange)}</span>`],
    ["Price", `<span class="dr-fig">${t(a.price)}</span>`],
    ["Mkt cap", `<span class="dr-fig">${t(a.marketCap)}</span>`],
    ["Position", `<span><span class="dr-tag ${pos === "SHORT" ? "short" : "long"}">${pos}</span></span>`],
    ["Target", `<span class="dr-fig">${t(a.target)}</span>`],
    ["Upside", `<span class="dr-fig ${upCls}">${t(upside)}</span>`],
    ["Horizon", `<span class="dr-fig">${t(a.horizon || "12 months")}</span>`],
    ["Date", `<span class="dr-fig">${t(a.date)}</span>`],
  ];
  return `<div class="head">
  <div class="dr-label">${t(img.kicker || "Research note")}</div>
  <h1>${t(a.company)}</h1>
  ${img.thesis || a.thesis ? `<p class="thesis">${t(img.thesis || a.thesis)}</p>` : ""}
</div>
<div class="dr-strip grid4">${cells.map(([l, v]) => `<div><span class="dr-label">${l}</span>${v}</div>`).join("")}</div>
<p class="price-note">${t(img.priceNote || `Prices as of ${a.date}.`)}</p>`;
}

function bullbear(img) {
  const li = (xs) => (xs || []).map((x) => `<li>${t(x)}</li>`).join("");
  return `${kicker(img.kicker || "Both sides", img.title)}
<div class="dr-bb">
  <section class="bull"><h4>${t(img.bullTitle || "Bull case")}</h4><ul>${li(img.bull)}</ul>${img.bullValue ? `<p class="bb-value up">${t(img.bullValue)}</p>` : ""}</section>
  <section class="bear"><h4>${t(img.bearTitle || "Bear case")}</h4><ul>${li(img.bear)}</ul>${img.bearValue ? `<p class="bb-value down">${t(img.bearValue)}</p>` : ""}</section>
</div>
${img.verdict ? `<p class="verdict"><span class="dr-label">Our view</span> ${t(img.verdict)}</p>` : ""}`;
}

function scenarios(img) {
  const cols = ["bear", "base", "bull"];
  const names = { bear: "Bear", base: "Base", bull: "Bull" };
  const head = `<tr><th></th>${cols.map((c) => `<th class="${c}">${names[c]}</th>`).join("")}</tr>`;
  const rows = (img.rows || [])
    .map((r) => {
      const cls = r.emphasis ? ' class="em"' : "";
      return `<tr${cls}><td class="lbl">${t(r.label)}</td>${cols
        .map((c) => {
          const v = String(r[c] ?? "");
          const sign = r.signed ? (v.trim().startsWith("-") ? " down" : v.trim().startsWith("+") ? " up" : "") : "";
          return `<td class="num${sign}">${t(v)}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  const weighted = img.weighted
    ? `<div class="weighted"><span class="dr-label">${t(img.weighted.label || "Probability-weighted value")}</span><span class="dr-fig">${t(img.weighted.value)}</span>${img.weighted.upside ? `<span class="dr-fig ${String(img.weighted.upside).trim().startsWith("-") ? "down" : "up"}">${t(img.weighted.upside)}</span>` : ""}</div>`
    : "";
  return `${kicker(img.kicker || "Valuation", img.title)}
<table class="scen">${head}${rows}</table>
${weighted}
<p class="source">${t(img.source || "Source: Dualis Research estimates.")}</p>`;
}

function niceTicks(min, max, n = 5) {
  const span = max - min || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

function chartSvg(img) {
  const W = 512, H = 260, L = 44, R = 22, T = 12, B = 28;
  const labels = img.x || [];
  const series = img.series || [];
  const refs = img.refs || [];
  const all = series.flatMap((s) => s.values).concat(refs.map((r) => r.value)).filter((v) => v != null);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i) => L + (labels.length < 2 ? 0 : (i * (W - L - R)) / (labels.length - 1));
  const Y = (v) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0 || 1));
  const fmt = (v) => `${img.yPrefix || ""}${v}${img.ySuffix || ""}`;
  const grid = ticks
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L - 6}" y="${Y(v) + 4}" class="yt">${esc(fmt(v))}</text>`)
    .join("");
  // Label every k-th point, picking k so the last point lands on a label (no crowded pair at the end).
  const n = labels.length;
  let every = Math.max(1, Math.ceil(n / 6));
  for (let k = every; k <= Math.max(every, n - 1); k++) if ((n - 1) % k === 0) { every = k; break; }
  const xl = labels
    .map((s, i) => (i % every === 0 || i === labels.length - 1 ? `<text x="${X(i)}" y="${H - 8}" class="xt"${i === n - 1 ? ' text-anchor="end" dx="8"' : ""}>${esc(s)}</text>` : ""))
    .join("");
  const colorOf = { brand: "var(--brand)", muted: "var(--muted)", long: "var(--long)", short: "var(--short)", ink: "var(--ink)" };
  const lines = series
    .map((s, si) => {
      const pts = s.values.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(" ");
      const c = colorOf[s.color || (si === 0 ? "brand" : "muted")];
      const dash = s.dashed ? ' stroke-dasharray="5 4"' : "";
      const last = s.values.map((v, i) => (v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), 0);
      return `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.25"${dash} stroke-linejoin="round"/><circle cx="${X(last)}" cy="${Y(s.values[last])}" r="3.5" fill="${c}"/>`;
    })
    .join("");
  const refLines = refs
    .map((r) => {
      const c = colorOf[r.color || "muted"];
      return `<line x1="${L}" x2="${W - R}" y1="${Y(r.value)}" y2="${Y(r.value)}" stroke="${c}" stroke-width="1.25" stroke-dasharray="3 3"/><text x="${L + 4}" y="${Y(r.value) - 5}" class="rt" fill="${c}">${esc(r.label)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${xl}${refLines}${lines}</svg>`;
}

function chart(img, spec) {
  let body;
  if (img.image) {
    const p = resolve(spec.__dir, img.image);
    body = `<img class="chart-img" src="${pathToFileURL(p).href}" alt="">`;
  } else {
    body = chartSvg(img);
  }
  const legend = (img.series || []).length > 1 || (img.refs || []).length
    ? `<div class="legend">${(img.series || [])
        .map((s, i) => `<span><i class="sw ${s.color || (i === 0 ? "brand" : "muted")}${s.dashed ? " dashed" : ""}"></i>${t(s.name)}</span>`)
        .join("")}</div>`
    : "";
  return `${kicker(img.kicker || "Chart", img.title)}
${img.subtitle ? `<p class="sub">${t(img.subtitle)}</p>` : ""}
${legend}
<div class="chart-box">${body}</div>
<p class="source">${t(img.source || "Source: Dualis Research estimates.")}</p>`;
}

const RENDER = { header, bullbear, scenarios, chart };

// ---------- Chrome ----------
function chrome(args, timeoutMs = 60000) {
  const profile = mkdtempSync(join(tmpdir(), "dr-chrome-"));
  const r = spawnSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
     `--user-data-dir=${profile}`, "--allow-file-access-from-files", "--virtual-time-budget=6000", ...args],
    { encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  );
  rmSync(profile, { recursive: true, force: true });
  return r;
}

function measure(htmlPath) {
  const r = chrome([`--window-size=${CSS_W},2000`, "--dump-dom", pathToFileURL(htmlPath).href]);
  const m = /data-h="(\d+)"/.exec(r.stdout || "");
  return m ? Number(m[1]) : null;
}

function screenshot(htmlPath, pngPath, h) {
  if (existsSync(pngPath)) rmSync(pngPath);
  const r = chrome([
    `--window-size=${CSS_W},${h}`,
    `--force-device-scale-factor=${SCALE}`,
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ]);
  return existsSync(pngPath) && !r.error;
}

function quicklook(htmlPath, pngPath) {
  const out = dirname(pngPath);
  spawnSync("qlmanage", ["-t", "-s", String(OUT_W), "-o", out, htmlPath], { timeout: 60000 });
  const produced = join(out, `${basename(htmlPath)}.png`);
  if (!existsSync(produced)) return false;
  spawnSync("mv", [produced, pngPath]);
  return true;
}

// ---------- main ----------
const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: node templates/render.mjs <spec.json>");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
spec.__dir = dirname(resolve(specPath));
const outDir = resolve(spec.__dir, spec.outDir || "images");
const buildDir = join(outDir, ".html");
mkdirSync(buildDir, { recursive: true });

let failed = 0;
for (const img of spec.images) {
  const fn = RENDER[img.type];
  if (!fn) {
    console.error(`Unknown image type "${img.type}". Use one of: ${Object.keys(RENDER).join(", ")}`);
    failed++;
    continue;
  }
  const name = img.file || `${img.type}.png`;
  const htmlPath = join(buildDir, name.replace(/\.png$/, ".html"));
  const pngPath = join(outDir, name);
  writeFileSync(htmlPath, page(`<div class="img-${img.type}">${fn(img, spec)}</div>`, spec));
  const h = measure(htmlPath);
  let ok = h ? screenshot(htmlPath, pngPath, h) : false;
  if (!ok) ok = quicklook(htmlPath, pngPath);
  console.log(`${ok ? "ok  " : "FAIL"} ${img.type.padEnd(9)} ${pngPath}${h ? `  (${OUT_W}x${Math.round(h * SCALE)})` : ""}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
