import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";
import { PRICED_WORD, signalWords, tagWord } from "@/content/signal-words";
import { COLOR } from "@/design/tokens";
import { formatUnit, periodLabel, seriesPeriod } from "@/console/exhibit-format";
import { sourceNote } from "@/console/source-labels";
import type { AlertInput } from "./data";

/**
 * The Signal Change alert as one PNG (Kevin 2026-11-09: « un mix entre le chart et la table des drivers avec la colonne
 * status »; Thierry 2026-11-16: no fair value, the real figure that breaks the story instead): the signal, what the market
 * believes, the reported figure against it with its chart (both compared periods coloured), then the drivers' Status.
 * Light theme of the design tokens. Node only: loaded by URL from the dimension so the console bundle never sees resvg.
 * Every text wraps whole (never cut by code).
 */

export const W = 1080;
const P = 56;
const INNER = W - 2 * P;
const FONT = "IBM Plex Sans";
const asset = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const FONTS = [asset("../growth-brief/fonts/IBMPlexSans-Regular.ttf"), asset("../growth-brief/fonts/IBMPlexSans-SemiBold.ttf")];
const MARK = readFileSync(asset("./mark.svg")).toString("base64");

const C = {
  ink: COLOR.ink.light,
  muted: COLOR.muted.light,
  rule: COLOR.rule.light,
  brand: COLOR.brand.light,
  long: COLOR.long.light,
  short: COLOR.short.light,
  longSoft: COLOR["long-soft"].light,
  shortSoft: COLOR["short-soft"].light,
  bench: COLOR["chart-light-bench"].light,
  /** The console's "warning" dot for a weak turn. */
  weak: COLOR["chart-line"].light,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
const dayLabel = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Rough IBM Plex Sans advance per character, in em (semibold is wider). */
const EM = { regular: 0.52, semibold: 0.56 };
export function wrap(text: string, width: number, size: number, weight: keyof typeof EM = "regular"): string[] {
  const max = Math.max(8, Math.floor(width / (size * EM[weight])));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
const textWidth = (text: string, size: number, weight: keyof typeof EM = "regular") => text.length * size * EM[weight];

type Svg = string[];
function text(out: Svg, x: number, y: number, s: string, o: { size: number; weight?: keyof typeof EM; color?: string; anchor?: "start" | "end"; spacing?: number }) {
  out.push(
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size}" font-weight="${o.weight === "semibold" ? 600 : 400}" fill="${o.color ?? C.ink}"${o.anchor === "end" ? ' text-anchor="end"' : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${esc(s)}</text>`,
  );
}
/** Wrapped lines from the baseline `y`; returns the y after the block. */
function lines(out: Svg, x: number, y: number, s: string, width: number, o: { size: number; weight?: keyof typeof EM; color?: string; anchor?: "start" | "end"; lead?: number }): number {
  const lead = o.lead ?? Math.round(o.size * 1.35);
  const ls = wrap(s, width, o.size, o.weight);
  ls.forEach((l, i) => text(out, x, y + i * lead, l, o));
  return y + (ls.length - 1) * lead;
}

/** A Status badge like the console's (dot + words, outlined pill): green = strong turn, orange = weak, grey = noise. */
function badge(out: Svg, xRight: number, yTop: number, effect: string, strength: string, side: "long" | "short"): number {
  const words = tagWord(effect, strength, side);
  const dot = effect === "reversal" && strength !== "noise" ? (strength === "strong" ? C.long : C.weak) : C.bench;
  const w = Math.round(textWidth(words, 22) * 0.9 + 52);
  const x = xRight - w;
  out.push(`<rect x="${x}" y="${yTop}" width="${w}" height="40" rx="20" fill="#fff" stroke="${C.rule}" stroke-width="2"/>`);
  out.push(`<circle cx="${x + 22}" cy="${yTop + 20}" r="6" fill="${dot}"/>`);
  text(out, x + 36, yTop + 28, words, { size: 22 });
  return w;
}

type Break = AlertInput["breaks"][number];

/**
 * The comparison the reality line makes, in reported values: « Q3-25 6.2M → Q3-26 7.5M (+21%) » when the judge named the
 * earlier period, else the latest value alone (never a comparison nobody made).
 */
export function comparison(b: Break): { text: string; periods: string[] } | null {
  const lead = b.chart.series[0];
  if (!lead) return null;
  const pts = b.chart.points.filter((p) => typeof p.values[lead.key] === "number");
  const last = pts.at(-1);
  if (!last) return null;
  const per = seriesPeriod(lead.key);
  const v = last.values[lead.key] as number;
  const show = (x: number) => formatUnit(x, lead.unit, lead.currency);
  const base = b.base ? pts.find((p) => p.period === b.base && p.period !== last.period) : undefined;
  if (!base) return { text: `${periodLabel(last.period, per)}: ${show(v)}`, periods: [last.period] };
  const v0 = base.values[lead.key] as number;
  const change = v0 !== 0 ? Math.round((v / v0 - 1) * 100) : null;
  return { text: `${periodLabel(base.period, per)} ${show(v0)} → ${periodLabel(last.period, per)} ${show(v)}${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change}%)`}`, periods: [base.period, last.period] };
}

/** The Exhibit of the reported figure, lead series only: the compared periods in the signal's colour, the others grey. */
function breakChartSvg(b: Break, lit: string[], accent: string, width: number, height: number): string {
  const lead = b.chart.series[0];
  const per = seriesPeriod(lead.key);
  const bars = b.chart.chart === "bar";
  const data = b.chart.points.map((p) => {
    const v = p.values[lead.key] ?? null;
    const on = lit.includes(p.period);
    return { value: v, itemStyle: { color: on ? accent : C.bench }, label: { show: bars && on, position: "top", color: accent, fontSize: 20, fontWeight: 600, fontFamily: FONT, formatter: () => (v === null ? "" : formatUnit(v, lead.unit, lead.currency)) } };
  });
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
  chart.setOption({
    backgroundColor: "#fff",
    animation: false,
    textStyle: { fontFamily: FONT },
    grid: { left: 110, right: 24, top: 36, bottom: 44 },
    xAxis: { type: "category", data: b.chart.points.map((p) => periodLabel(p.period, per)), axisLine: { lineStyle: { color: C.rule } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 18, fontFamily: FONT, hideOverlap: true } },
    yAxis: { type: "value", scale: !bars, splitNumber: 4, axisLabel: { color: C.muted, fontSize: 18, fontFamily: FONT, formatter: (v: number) => formatUnit(v, lead.unit, lead.currency) }, splitLine: { lineStyle: { color: C.rule } } },
    series: [
      bars
        ? { type: "bar", data, barMaxWidth: 56 }
        : { type: "line", data: data.map((d) => ({ ...d, symbol: lit.length ? "circle" : "none", symbolSize: d.itemStyle.color === accent ? 14 : 0, label: { ...d.label, show: d.itemStyle.color === accent } })), connectNulls: true, lineStyle: { color: C.brand, width: 3 } },
    ],
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

/** The whole picture as SVG (height follows the content). */
export function alertSvg(a: AlertInput): string {
  const out: Svg = [];
  let y = 84;
  // Header: the company, its ticker.
  y = lines(out, P, y, a.name ?? a.symbol, INNER - 80, { size: 40, weight: "semibold", lead: 50 });
  y += 40;
  text(out, P, y, a.symbol, { size: 26, color: C.muted });
  out.push(`<image href="data:image/svg+xml;base64,${MARK}" x="${W - P - 64}" y="44" width="64" height="64"/>`);

  // The new signal, its strength, and what it was.
  y += 32;
  const call = a.toSignal;
  const callW = Math.round(textWidth(call, 26, "semibold") + 36);
  out.push(`<rect x="${P}" y="${y}" width="${callW}" height="44" rx="8" fill="${call === "BUY" ? C.longSoft : C.shortSoft}"/>`);
  text(out, P + 18, y + 31, call, { size: 26, weight: "semibold", color: call === "BUY" ? C.long : C.short });
  const bw = badge(out, P + callW + 16 + Math.round(textWidth(tagWord("reversal", a.toStrength, a.side), 22) * 0.9 + 52), y + 2, "reversal", a.toStrength, a.side);
  text(out, P + callW + 16 + bw + 20, y + 30, `was ${signalWords(a.fromSignal, a.fromStrength)}`, { size: 24, color: C.muted });

  // What the market believes, then the reported figure that breaks it, with its chart.
  y += 44;
  const accent = a.side === "long" ? C.long : C.short;
  if (a.narrative) {
    y += 48;
    text(out, P, y, "THE MARKET BELIEVES", { size: 20, color: C.muted, spacing: 2 });
    y = lines(out, P, y + 40, a.narrative, INNER, { size: 28, lead: 38 });
  }
  for (const b of a.breaks) {
    y += 64;
    text(out, P, y, "THE REPORTED FIGURE", { size: 20, color: accent, spacing: 2 });
    y = lines(out, P, y + 42, b.headline ?? b.chart.title, INNER, { size: 30, weight: "semibold", lead: 40 });
    const cmp = comparison(b);
    y += 40;
    text(out, P, y, b.chart.title, { size: 22, color: C.muted });
    if (cmp) {
      y += 36;
      text(out, P, y, cmp.text, { size: 26, weight: "semibold", color: accent });
    }
    y += 16;
    const chartH = 380;
    out.push(breakChartSvg(b, cmp?.periods ?? [], accent, INNER, chartH).replace(/^<\?xml[^>]*>/, "").replace("<svg ", `<svg x="${P}" y="${y}" `));
    y += chartH;
  }

  // Narrative Drivers with their Status, like the panel's table.
  y += 64;
  text(out, P, y, "NARRATIVE DRIVERS", { size: 22, color: C.muted, spacing: 2 });
  y += 24;
  const tableTop = y;
  const leftW = 560;
  const rightX = P + INNER - 24;
  const statusW = INNER - 48 - leftW - 40;
  const body: Svg = [];
  let ry = tableTop + 56;
  text(body, P + 24, tableTop + 37, "Driver", { size: 22, color: C.muted });
  text(body, rightX, tableTop + 37, "Status", { size: 22, color: C.muted, anchor: "end" });
  body.push(`<line x1="${P}" y1="${ry}" x2="${P + INNER}" y2="${ry}" stroke="${C.rule}" stroke-width="2"/>`);
  if (a.drivers.length === 0) {
    text(body, P + 24, ry + 48, "No drivers on this thesis yet.", { size: 22, color: C.muted });
    ry += 80;
  }
  a.drivers.forEach((d, i) => {
    const top = ry + 28;
    // Left: category, title, one sentence.
    const catW = Math.round(textWidth(d.category, 20) * 0.96 + 34);
    body.push(`<rect x="${P + 24}" y="${top}" width="${catW}" height="36" rx="18" fill="#fff" stroke="${C.ink}" stroke-width="1.5"/>`);
    text(body, P + 40, top + 25, d.category, { size: 20 });
    let ly = lines(body, P + 24, top + 84, d.title, leftW, { size: 28, weight: "semibold", lead: 36 });
    if (d.summary) ly = lines(body, P + 24, ly + 40, d.summary, leftW, { size: 23, lead: 32 });
    // Right: the Status (tag, current state, since, priced in).
    let sy = top;
    if (d.state) {
      badge(body, rightX, sy, d.state.effect, d.state.strength, a.side);
      sy += 40;
      if (d.state.effect !== "noise") {
        if (d.state.headline) sy = lines(body, rightX, sy + 34, d.state.headline, statusW, { size: 22, weight: "semibold", anchor: "end", lead: 28 });
        if (d.state.since) {
          sy += 30;
          text(body, rightX, sy, `Since ${dayLabel(d.state.since)}`, { size: 21, color: C.muted, anchor: "end" });
        }
        if (d.state.pricedIn) {
          sy += 30;
          text(body, rightX, sy, PRICED_WORD[d.state.pricedIn] ?? d.state.pricedIn, { size: 21, color: C.muted, anchor: "end" });
        }
      }
    } else {
      text(body, rightX, sy + 26, "Not judged yet", { size: 21, color: C.muted, anchor: "end" });
      sy += 30;
    }
    ry = Math.max(ly, sy) + 36;
    if (i < a.drivers.length - 1) body.push(`<line x1="${P}" y1="${ry}" x2="${P + INNER}" y2="${ry}" stroke="${C.rule}" stroke-width="2"/>`);
  });
  out.push(`<rect x="${P}" y="${tableTop}" width="${INNER}" height="${ry - tableTop}" rx="12" fill="#fff" stroke="${C.rule}" stroke-width="2"/>`);
  out.push(...body);

  // Source line + disclaimer.
  y = ry + 52;
  const source = sourceNote([...new Set(a.breaks.flatMap((b) => b.chart.sources)), "dualis"]) ?? "Source: Dualis Research.";
  y = lines(out, P, y, `${source} Not investment advice.`, INNER, { size: 19, color: C.muted });
  const H = Math.ceil(y + 48);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${out.join("")}</svg>`;
}

export function alertPng(a: AlertInput): Buffer {
  const png = new Resvg(alertSvg(a), { font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: FONT } }).render().asPng();
  return Buffer.from(png);
}
