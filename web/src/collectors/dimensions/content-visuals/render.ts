import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";
import { formatUnit, periodLabel, seriesPeriod } from "../../../console/exhibit-format";
import { COLOR } from "../../../design/tokens";
import { sourceNote } from "../../../console/source-labels";
import type { VisualExhibit, VisualInput } from "./data";

/**
 * Node only (loaded by URL from the dimension: the console bundle never sees resvg or ffmpeg). Three pictures of an
 * Idea in the Dualis look: `chart` = the most striking Exhibit of the driver the Idea cites (`exhibitSvg`), or the
 * price against the fair value (`chartSvg`), as a Notes and X chart (design tokens: white data on deep indigo), `montage` = a 16:9 card on deep indigo with the idea in words above the chart and the mark in the
 * corner, `video` = the same card with the line drawing itself, then the fair value and the gap (MP4, H.264).
 */

export const W = 1280;
export const H = 720;
const FONT = "IBM Plex Sans";
/**
 * The Notes and X chart, from design/tokens.json (Thierry 2026-11-09, his pick C): white data on the deep indigo
 * ground, comparisons muted, a chart with more series takes the `chart-series` palette (dark values).
 */
const NOTE = {
  bg: COLOR["chart-bg"].dark,
  grid: COLOR["chart-grid"].dark,
  base: COLOR["chart-base"].dark,
  text: COLOR["chart-text"].dark,
  muted: COLOR["chart-muted"].dark,
  main: COLOR["chart-bar"].dark,
  bench: COLOR["chart-bar-muted"].dark,
  palette: Array.from({ length: 10 }, (_, i) => COLOR[`chart-series-${i + 1}` as keyof typeof COLOR].dark),
};
const INDIGO = "#1A1640";
const LAVENDER = "#b9b4e0";
const asset = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const FONTS = [asset("../growth-brief/fonts/IBMPlexSans-Regular.ttf"), asset("../growth-brief/fonts/IBMPlexSans-SemiBold.ttf")];
const MARK = readFileSync(asset("../growth-brief/mark-white.svg")).toString("base64");

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 4 : Math.abs(v) >= 1000 ? 0 : 2 });
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** « Sep-25 », like the driver charts' periods (Kevin 2026-11-09: the time axis printed « Sept 26 » three times). */
const monthLabel = (v: number) => {
  const d = new Date(v);
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
};

/** One tick per month start inside the chart, every 1, 2 or 3 months so up to 6 or 7 labels show, each a different month. */
export function monthTicks(from: number, to: number): number[] {
  const start = new Date(from);
  const months = (new Date(to).getUTCFullYear() - start.getUTCFullYear()) * 12 + new Date(to).getUTCMonth() - start.getUTCMonth();
  const step = months <= 6 ? 1 : months <= 13 ? 2 : 3;
  const out: number[] = [];
  for (let m = 1; m <= months; m++) {
    const t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1);
    if (t <= to && (months - m) % step === 0) out.push(t);
  }
  return out;
}

export type Frame = {
  /** Share of the closes drawn (0..1]. */
  progress: number;
  /** Opacity of the fair value line and the gap label (0..1). */
  reveal: number;
};
const FULL: Frame = { progress: 1, reveal: 1 };

/** The gap in words: "32% below fair value". */
export function gapWords(price: number, fair: number): string {
  const g = price / fair - 1;
  return `${Math.abs(Math.round(g * 100))}% ${g < 0 ? "below" : "above"} fair value`;
}

function series(input: VisualInput, frame: Frame, onCard: boolean) {
  const n = Math.max(2, Math.ceil(input.bars.length * frame.progress));
  const shown = input.bars.slice(0, n);
  const last = shown[shown.length - 1];
  const out: echarts.SeriesOption[] = [
    {
      type: "line",
      data: shown.map((b) => [ts(b.date), b.close]),
      symbol: "none",
      lineStyle: { color: "#fff", width: onCard ? 4 : 3 },
      // Clear of the ring on the last point (image-correction 2026-11-12: « the circle hides the first digit »).
      endLabel: { show: true, distance: 24, formatter: fmt(last.close), color: "#fff", fontSize: 22, fontWeight: 600, fontFamily: FONT },
      z: 3,
    },
  ];
  if (input.fair && frame.reveal > 0) {
    const f = input.fair;
    out.push({
      type: "line",
      data: [
        [ts(input.bars[0].date), f.value],
        [ts(input.bars[input.bars.length - 1].date), f.value],
      ],
      symbol: "none",
      lineStyle: { color: onCard ? LAVENDER : NOTE.muted, width: 2, type: "dashed", opacity: frame.reveal },
      // The Note chart shades the fair value range, low to high (Kevin 2026-11-09), like the console and the site.
      ...(!onCard && f.low != null && f.high != null && f.high > f.low
        ? { markArea: { silent: true, itemStyle: { color: "rgba(255,255,255,0.08)" }, label: { show: false }, data: [[{ yAxis: f.low }, { yAxis: f.high }]] } }
        : {}),
      endLabel: {
        show: true,
        // Close to the price's end value, the two labels would overlap: the fair value's steps away from it.
        offset: [0, nearEnd(input, f.value) ? (last.close > f.value ? 26 : -26) : 0],
        formatter: `Fair value ${fmt(f.value)}`,
        color: onCard ? LAVENDER : NOTE.muted,
        fontSize: 20,
        fontFamily: FONT,
        opacity: frame.reveal,
      },
      z: 2,
    });
  }
  return out;
}

/** Whether a level sits within 10% of the chart's height of the last close (their end labels would overlap). */
function nearEnd(input: VisualInput, level: number): boolean {
  const { min, max } = yRange(input);
  return Math.abs((input.bars.at(-1)?.close ?? level) - level) < (max - min) * 0.1;
}

function yRange(input: VisualInput) {
  const f = input.fair;
  const values = [...input.bars.map((b) => b.close), ...(f ? [f.value, f.low ?? f.value, f.high ?? f.value] : [])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || hi * 0.1;
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

function withHeadroom<T extends { yAxis: { min: number; max: number } }>(ax: T): T {
  return { ...ax, yAxis: { ...ax.yAxis, max: ax.yAxis.max + (ax.yAxis.max - ax.yAxis.min) * 0.6 } };
}

function axes(input: VisualInput, onCard: boolean) {
  const { min, max } = yRange(input);
  const ticks = monthTicks(ts(input.bars[0].date), ts(input.bars[input.bars.length - 1].date));
  const label = { color: onCard ? LAVENDER : NOTE.muted, fontSize: 18, fontFamily: FONT };
  return {
    xAxis: {
      type: "time" as const,
      min: ts(input.bars[0].date),
      max: ts(input.bars[input.bars.length - 1].date),
      axisLine: { lineStyle: { color: onCard ? "#3a3470" : NOTE.base } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...label, color: onCard ? LAVENDER : NOTE.text, formatter: (v: number) => monthLabel(v), customValues: ticks },
    },
    yAxis: {
      type: "value" as const,
      min,
      max,
      splitNumber: 4,
      // Round ticks only: the padded min and max would print odd values (1.59, 3.46).
      axisLabel: { ...label, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => fmt(v) },
      splitLine: { lineStyle: { color: onCard ? "#25205a" : NOTE.grid } },
    },
  };
}

/**
 * What the Note chart says out loud (Kevin 2026-11-09: « une flèche dessus, un texte de note, orienté regardez »): the
 * claim as its headline, ONE point in colour (green when the story turns up below fair value, red when it cracks above),
 * an arrow with a short note on it, and the headline of the news it rests on with its publisher's logo above.
 */
export type Annotation = {
  /** The point the arrow hits: an Exhibit period, or a price date. */
  point: string;
  note: string;
  /** What the price's narrative said. */
  priceSays: string;
  title: string;
  /** Under the title: what the chart measures, in plain words. */
  chartLabel: string;
  tone: "long" | "short" | "neutral";
  /** The breaking-news inset: `ago` is when the news came out, said as « 2h ago ». */
  banner: { headline: string; publisher: string; logo: string | null; ago: string } | null;
  /**
   * `breaking` (Substack Notes, skill breaking-chart): news card + pasted price card. `pro` (X posts, skill x-post, Kevin
   * 2026-11-10): the same chart, point, arrow and note, no news card, no price card, a factual title.
   */
  style?: "breaking" | "pro";
};

const BANNER_H = 112;

/**
 * The words over the chart: with a news inset the claim would repeat it (Kevin 2026-11-09: « enlève cette sentence car
 * duplicate de la news »), so the chart label becomes the heading; without one, the claim heads and the label sits under.
 */
function heading(a: Annotation, company: string): { title: string; sub: string | null } {
  const label = `${company}: ${a.chartLabel}`;
  // The professional chart heads with what it shows, never the alarm (that lives in the X post's text).
  if (a.style === "pro") return { title: label, sub: null };
  return a.banner ? { title: label, sub: null } : { title: a.title, sub: label };
}
const toneColour = (t: Annotation["tone"]) => (t === "long" ? COLOR.long.dark : t === "short" ? COLOR.short.dark : COLOR.accent.dark);

/**
 * The tone comes from the thesis (CLAUDE.md « Two theses »): a long driver's turn is an inflection (green), a short
 * one's a crack (red). The price chart takes its drivers' side when they agree, else where the price sits.
 */
export function toneOf(input: VisualInput, exhibit: VisualExhibit | null = null): Annotation["tone"] {
  if (exhibit) return exhibit.side;
  const sides = [...new Set(input.drivers.map((d) => d.side))];
  if (sides.length === 1) return sides[0];
  const last = input.bars.at(-1);
  if (!input.fair || !last) return "neutral";
  return last.close < input.fair.value ? "long" : "short";
}

/** « 2h ago », « 3d ago »: how long before the chart was drawn the news came out. */
export function timeAgo(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (min < 60) return min <= 1 ? "just now" : `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * The breaking-news inset (Kevin 2026-11-09: « un encart rectangulaire en mode breaking news, with a time ago »): a
 * white card on the indigo, a red BREAKING stamp, the publisher's logo, name and time, the headline in black.
 */
function bannerGraphics(b: NonNullable<Annotation["banner"]>, box: { x: number; y: number; w: number; h: number; big: boolean } = { x: 40, y: 18, w: W - 40 - 130, h: BANNER_H - 30, big: false }) {
  const { x, y, w, h, big } = box;
  const stampW = 168;
  const logo = big ? 28 : 24;
  const info = x + stampW + 18 + (b.logo ? logo + 10 : 0);
  const pubY = big ? y + 34 : y + 22;
  return [
    { type: "rect", shape: { x: x + 5, y: y + 6, width: w, height: h }, style: { fill: "rgba(0,0,0,0.45)" }, z: 10 },
    { type: "rect", shape: { x, y, width: w, height: h }, style: { fill: "#fff" }, z: 11 },
    { type: "rect", shape: { x, y, width: stampW, height: h }, style: { fill: COLOR.breaking.dark }, z: 12 },
    { type: "text", style: { text: "BREAKING", x: x + stampW / 2, y: y + h / 2 - 14, fill: "#fff", fontSize: big ? 30 : 26, fontWeight: 600, fontFamily: FONT, align: "center", verticalAlign: "middle" }, z: 13 },
    { type: "text", style: { text: b.ago, x: x + stampW / 2, y: y + h / 2 + 20, fill: "#fff", fontSize: big ? 19 : 17, fontWeight: 400, fontFamily: FONT, align: "center", verticalAlign: "middle" }, z: 13 },
    ...(b.logo ? [{ type: "image", style: { image: `data:image/png;base64,${b.logo}`, x: x + stampW + 18, y: pubY - logo / 2, width: logo, height: logo }, z: 13 }] : []),
    { type: "text", style: { text: b.publisher.toUpperCase(), x: info, y: pubY, fill: "#555", fontSize: big ? 19 : 17, fontWeight: 600, fontFamily: FONT, verticalAlign: "middle" }, z: 13 },
    big
      ? { type: "text", style: { text: b.headline, x: x + stampW + 18, y: y + 62, fill: "#111", fontSize: 34, lineHeight: 44, fontWeight: 600, fontFamily: FONT, verticalAlign: "top", width: w - stampW - 40, overflow: "break" }, z: 13 }
      : { type: "text", style: { text: b.headline, x: x + stampW + 18, y: y + 56, fill: "#111", fontSize: 24, fontWeight: 600, fontFamily: FONT, verticalAlign: "middle", width: w - stampW - 36, overflow: "truncate" }, z: 13 },
  ];
}

/** Arrow + note box pointing at (px, py), placed where it fits inside the plot. */
type Rect = { x: number; y: number; w: number; h: number };
function calloutGraphics(px: number, py: number, a: Annotation, colour: string, plot: { left: number; top: number; right: number; bottom: number }, ring = true, obstacles: Rect[] = []) {
  // Two lines: the fact, what the price said (Kevin 2026-11-09, the driver line removed).
  const lines = [
    { text: a.note, size: 24 },
    { text: `VS price narrative: "${a.priceSays}"`, size: 18 },
  ];
  const boxW = Math.min(620, Math.round(Math.max(...lines.map((l) => l.text.length * l.size * 0.56)) + 40));
  // A line longer than the box wraps (never cut with « … »: the reviewer read cut notes as pictures that do not stand alone).
  const rows = lines.map((l) => Math.max(1, Math.ceil((l.text.length * l.size * 0.5) / (boxW - 40))));
  const lineTop = (i: number) => lines.slice(0, i).reduce((t, p, k) => t + rows[k] * (p.size + 6) + 4, 0);
  const boxH = 26 + lineTop(lines.length);
  const gap = 70;
  // A bar is hit from the side: the note sits high in the free space over the shorter bars.
  const candidates = [
    ...(ring ? [] : [{ x: px - boxW - gap, y: plot.top + 10 }, { x: px + gap, y: plot.top + 10 }]),
    { x: px - boxW - gap, y: py - boxH - gap / 2 },
    { x: px + gap, y: py - boxH - gap / 2 },
    { x: px - boxW - gap, y: py - boxH / 2 },
    { x: px + gap, y: py - boxH / 2 },
    { x: px - boxW / 2, y: py + gap },
  ];
  // Over the shorter bars: slide the box left and down until it hides no other bar or its value.
  if (!ring) for (let dy = 0; dy <= 200; dy += 20) for (let dx = 0; dx <= 600; dx += 40) candidates.push({ x: px - boxW - gap - dx, y: plot.top + 10 + dy });
  const clear = (c: { x: number; y: number }) => obstacles.every((o) => c.x + boxW < o.x || o.x + o.w < c.x || c.y + boxH < o.y || o.y + o.h < c.y);
  const fits = (c: { x: number; y: number }) => c.x >= plot.left && c.x + boxW <= plot.right && c.y >= plot.top && c.y + boxH <= plot.bottom && clear(c);
  // Still hidden: scan the plot, nearest free spot to the point first (the price line is an obstacle: the note never hides it).
  if (!candidates.some(fits)) {
    const scan: { x: number; y: number }[] = [];
    for (let y = plot.top; y + boxH <= plot.bottom; y += 16) for (let x = plot.left; x + boxW <= plot.right; x += 24) scan.push({ x, y });
    // Above the point first: the empty headroom is up there, the fair value band below.
    const dist = (c: { x: number; y: number }) => Math.hypot(c.x + boxW / 2 - px, c.y + boxH / 2 - py) + (c.y + boxH > py ? 2000 : 0);
    candidates.push(...scan.sort((a, b) => dist(a) - dist(b)));
  }
  // No spot is wholly free (two lines filling the plot): the spot inside the plot that covers the fewest obstacles.
  const inside = (c: { x: number; y: number }) => c.x >= plot.left && c.x + boxW <= plot.right && c.y >= plot.top && c.y + boxH <= plot.bottom;
  const hits = (c: { x: number; y: number }) => obstacles.filter((o) => !(c.x + boxW < o.x || o.x + o.w < c.x || c.y + boxH < o.y || o.y + o.h < c.y)).length;
  const box = candidates.find(fits) ?? [...candidates.filter(inside)].sort((p, q) => hits(p) - hits(q))[0] ?? candidates[0];
  // The arrow leaves the box edge nearest the point and stops short of it.
  const sx = Math.min(Math.max(px, box.x), box.x + boxW);
  const sy = Math.min(Math.max(py, box.y), box.y + boxH);
  const len = Math.hypot(px - sx, py - sy) || 1;
  const ux = (px - sx) / len;
  const uy = (py - sy) / len;
  const ex = px - ux * 18;
  const ey = py - uy * 18;
  const head = 16;
  const tri = [
    [ex + ux * 4, ey + uy * 4],
    [ex - ux * head - uy * head * 0.6, ey - uy * head + ux * head * 0.6],
    [ex - ux * head + uy * head * 0.6, ey - uy * head - ux * head * 0.6],
  ];
  return [
    ...(ring ? [{ type: "circle", shape: { cx: px, cy: py, r: 13 }, style: { fill: "none", stroke: colour, lineWidth: 4 }, z: 20 }] : []),
    { type: "line", shape: { x1: sx, y1: sy, x2: ex - ux * head * 0.6, y2: ey - uy * head * 0.6 }, style: { stroke: colour, lineWidth: 4 }, z: 20 },
    { type: "polygon", shape: { points: tri }, style: { fill: colour }, z: 20 },
    { type: "rect", shape: { x: box.x, y: box.y, width: boxW, height: boxH, r: 8 }, style: { fill: colour }, z: 20 },
    ...lines.map((l, i) => ({
      type: "text",
      style: {
        text: l.text,
        x: box.x + 20,
        y: box.y + 14 + lineTop(i),
        fill: INDIGO,
        fontSize: l.size,
        fontWeight: i === 1 ? 400 : 600,
        fontFamily: FONT,
        verticalAlign: "top",
        width: boxW - 40,
        overflow: "break",
        lineHeight: l.size + 6,
      },
      z: 21,
    })),
  ];
}

/**
 * Every line of a line chart, sampled between its points, plus the lead series' end label: the note box never covers a
 * line or the last value (the reviewer: « the note box covered the line's last point and value »).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lineObstacles(chart: any, series: { index: number; values: (number | null | undefined)[] }[], at: (k: number, v: number) => unknown[]): Rect[] {
  const out: Rect[] = [];
  for (const s of series) {
    const pts = s.values.flatMap((v, k) => (typeof v === "number" ? [chart.convertToPixel({ seriesIndex: s.index }, at(k, v)) as number[]] : []));
    pts.forEach(([x, y], i) => {
      out.push({ x: x - 6, y: y - 12, w: 12, h: 24 });
      const next = pts[i + 1];
      if (next) for (let t = 1; t < 8; t++) out.push({ x: x + ((next[0] - x) * t) / 8 - 6, y: y + ((next[1] - y) * t) / 8 - 12, w: 12, h: 24 });
    });
    if (s.index === 0 && pts.length) {
      const [x, y] = pts[pts.length - 1];
      out.push({ x: x - 6, y: y - 18, w: 140, h: 36 });
    }
  }
  return out;
}

function withMark(svg: string, x: number, y: number, size: number): string {
  return svg.replace("</svg>", `<image href="data:image/svg+xml;base64,${MARK}" x="${x}" y="${y}" width="${size}" height="${size}"/></svg>`);
}

/** The professional chart's grey line (skill x-post): where the share price sits against the fair value, in plain words. */
function proSubtitle(input: VisualInput): string {
  const last = input.bars.at(-1);
  if (!input.fair || !last) return "";
  const cur = input.fair.currency ?? "";
  return `Share price ${fmt(last.close)} ${cur} · ${gapWords(last.close, input.fair.value)} ${fmt(input.fair.value)} ${cur}`.trim();
}

/** Price vs fair value as a Notes and X chart (`NOTE`); with an annotation, its claim, arrow, news card and the pasted price card. */
export function chartSvg(input: VisualInput, frame: Frame = FULL, a: Annotation | null = null): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  const last = input.bars[input.bars.length - 1];
  const company = input.companyName ?? input.symbol;
  const subtitle = input.fair ? `Last 12 months · ${gapWords(last.close, input.fair.value)} · fair value ${fmt(input.fair.value)} ${input.fair.currency ?? ""}` : "Last 12 months";
  // Same layout as the driver charts (Kevin 2026-11-09): the big BREAKING card top left, the Signal and the way to the fair
  // value range top right, the chart label small above the chart, the mark bottom right.
  const pro = a?.style === "pro";
  const news = !!a?.banner && !pro;
  // The same pasted price card as the driver charts (Kevin 2026-11-09: « tu ne respectes pas du tout », his reference).
  const card = !!a && !pro && !!input.fair && input.bars.length >= 20;
  const cardY = news ? 34 : 22;
  const newsBox = { x: 40, y: 28, w: card ? W - 40 - CARD_W - 40 - 40 : W - 80 - 100, h: 200, big: true };
  const labelTop = newsBox.y + newsBox.h + 26;
  const head = a ? heading(a, company) : null;
  const titleW = card ? W - 56 - CARD_W - 40 - 40 : pro ? W - 112 : W - 112 - 96;
  // Words wrap, never cut with « … », and the period is said once (the chart label carries it): the reviewer read
  // « · Last 12 m... » as a picture that does not stand alone (2026-11-11).
  const titleText = news ? "" : head ? head.title : `${company} share price vs fair value`;
  const gap = input.fair ? `${gapWords(last.close, input.fair.value)} · fair value ${fmt(input.fair.value)} ${input.fair.currency ?? ""}`.trim() : "";
  const subText = news && head ? [head.title, gap].filter(Boolean).join(" · ") : head ? [head.sub, gap].filter(Boolean).join(" · ") : subtitle;
  const subSize = news ? 21 : 22;
  const subW = news ? W - 112 : titleW;
  const wraps = (text: string, size: number, width: number) => Math.min(2, Math.max(1, Math.ceil((text.length * size * 0.55) / width)));
  const titleExtra = titleText ? (wraps(titleText, 34, titleW) - 1) * 42 : 0;
  const subExtra = (wraps(subText, subSize, subW) - 1) * 28;
  const grid = { left: 110, right: 200, top: (news ? labelTop + 28 + 44 : card ? cardY + CARD_H + 70 : 160 + titleExtra) + subExtra, bottom: 92 };
  chart.setOption({
    backgroundColor: NOTE.bg,
    animation: false,
    textStyle: { fontFamily: FONT },
    title: [
      { text: titleText, left: 56, top: 44, textStyle: { color: "#fff", fontSize: 34, lineHeight: 42, fontWeight: 600, fontFamily: FONT, width: titleW, overflow: "break" } },
      {
        text: subText,
        left: 56,
        top: news ? labelTop : card ? grid.top - 48 - subExtra : 94 + titleExtra,
        textStyle: { color: NOTE.muted, fontSize: subSize, lineHeight: 28, fontWeight: 400, fontFamily: FONT, width: subW, overflow: "break" },
      },
      { text: `Source: ${input.priceSources.join(", ")}, Dualis Research`, left: 56, bottom: 28, textStyle: { color: NOTE.muted, fontSize: 16, fontWeight: 400, fontFamily: FONT } },
    ],
    grid,
    // With a note, room above the line for it (like the bars' headroom): the line keeps the lower 60% of the plot.
    ...(a ? withHeadroom(axes(input, false)) : axes(input, false)),
    series: series(input, frame, false),
  });
  if (a) {
    const bar = input.bars.find((b) => b.date === a.point);
    if (!bar) throw new Error(`annotation point ${a.point} is not a close of the chart`);
    const [px, py] = chart.convertToPixel({ seriesIndex: 0 }, [ts(bar.date), bar.close]) as number[];
    // Every close of the line is an obstacle: the note never hides the price.
    const obstacles: Rect[] = input.bars.map((b) => {
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [ts(b.date), b.close]) as number[];
      return { x: x - 6, y: y - 12, w: 12, h: 24 };
    });
    // The value printed at the line's end is an obstacle too.
    const [lx, ly] = chart.convertToPixel({ seriesIndex: 0 }, [ts(last.date), last.close]) as number[];
    obstacles.push({ x: lx - 6, y: ly - 18, w: 160, h: 36 });
    // The fair value line and its label are part of the claim: the note never covers them.
    if (input.fair) {
      const [, fy] = chart.convertToPixel({ seriesIndex: 0 }, [ts(last.date), input.fair.value]) as number[];
      obstacles.push({ x: grid.left, y: fy - 14, w: W - grid.left, h: 28 });
    }
    chart.setOption({
      graphic: [
        ...(news && a.banner ? bannerGraphics(a.banner, newsBox) : []),
        ...calloutGraphics(px, py, a, toneColour(a.tone), { left: grid.left, top: grid.top, right: W - 40, bottom: H - grid.bottom }, true, obstacles),
      ],
    });
  }
  const svg = chart.renderToSVGString();
  chart.dispose();
  const marked = card || pro ? withMark(svg, W - 56 - 40, H - 62, 40) : withMark(svg, W - 56 - 72, 40, 72);
  return card ? withCard(marked, signalCardSvg(input), W - 40 - CARD_W, cardY) : marked;
}

/**
 * A driver's Exhibit as a Notes and X chart (`NOTE`): white columns or line for the lead series, the palette for the others, values
 * on the columns, the takeaway under the title. Every number is the one stored in gold.exhibits.
 */
export function exhibitSvg(input: VisualInput, e: VisualExhibit, a: Annotation | null = null): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  const lead = e.series[0];
  const fmtV = (v: number) => formatUnit(v, lead.unit, lead.currency);
  const period = seriesPeriod(lead.key);
  const label = { color: NOTE.muted, fontSize: 18, fontFamily: FONT };
  const bars = e.chart === "bar";
  const legend = e.series.length > 1;
  const note = sourceNote([...e.sources, "dualis"]) ?? "Source: Dualis Research.";
  // With a news inset the news takes the top of the image, big, where the headline was (Kevin 2026-11-09: « mets la
  // news prendre plus de place sur le trou laissé »); the chart label stays small above the chart.
  const pro = a?.style === "pro";
  const news = !!a?.banner && !pro;
  const off = 0;
  const hit = a ? e.points.findIndex((p) => p.period === a.point) : -1;
  if (a && hit === -1) throw new Error(`annotation point ${a.point} is not a period of exhibit ${e.id}`);
  const accent = a ? toneColour(a.tone) : NOTE.main;
  // With an annotation and a fair value, the price card sits top right and the headline wraps beside it.
  const card = !!a && !pro && !!input.fair && input.bars.length >= 20;
  const cardY = news ? 34 : off + 22;
  const newsBox = { x: 40, y: 28, w: card ? W - 40 - CARD_W - 40 - 40 : W - 80 - 100, h: 200, big: true };
  const titleW = card ? W - 56 - CARD_W - 40 - 40 : pro ? W - 112 : W - 112 - (off ? 0 : 96);
  const titleSize = a ? 34 : 32;
  const head = a ? heading(a, input.companyName ?? input.symbol) : null;
  // The title wraps (never cut with « … »): every layout below it moves down by its extra line.
  const titleLines = head && !news ? Math.min(2, Math.max(1, Math.ceil((head.title.length * titleSize * 0.55) / titleW))) : 1;
  const titleExtra = (titleLines - 1) * 42;
  const subTop = 40 + off + (titleLines - 1) * 42 + 48;
  const labelTop = newsBox.y + newsBox.h + 26;
  const grid = { left: 110, right: bars ? 56 : 170, top: news ? labelTop + 28 + 44 + (legend ? 30 : 0) : card ? Math.max(cardY + CARD_H + 30, subTop + 60) + (legend ? 30 : 0) : (legend ? 200 : 190) + off + titleExtra, bottom: 92 };
  chart.setOption({
    backgroundColor: NOTE.bg,
    animation: false,
    textStyle: { fontFamily: FONT },
    title: [
      { text: news ? "" : head ? head.title : `${input.companyName ?? input.symbol}: ${e.title}`, left: 56, top: 40 + off, textStyle: { color: "#fff", fontSize: titleSize, lineHeight: 42, fontWeight: 600, fontFamily: FONT, width: titleW, overflow: "break" } },
      { text: news && a ? `${input.companyName ?? input.symbol}: ${a.chartLabel}` : pro ? proSubtitle(input) : head ? (head.sub ?? "") : e.takeaway, left: 56, top: news ? labelTop : card ? subTop : 88 + off + titleExtra, textStyle: { color: NOTE.muted, fontSize: 21, lineHeight: 28, fontWeight: 400, fontFamily: FONT, width: news ? W - 112 : card ? titleW : W - 112 - 96, overflow: "break" } },
      { text: note, left: 56, bottom: 28, textStyle: { color: NOTE.muted, fontSize: 16, fontWeight: 400, fontFamily: FONT } },
    ],
    legend: legend
      ? // Legend on top, left aligned (design tokens chart rule).
        { show: true, left: 56, top: news ? labelTop + 34 : card ? grid.top - 34 : 140 + off + titleExtra, right: 56, icon: "rect", itemWidth: 14, itemHeight: 14, itemGap: 18, textStyle: { color: NOTE.text, fontSize: 16, fontFamily: FONT }, data: e.series.map((s) => s.label) }
      : { show: false },
    grid,
    xAxis: {
      type: "category",
      data: e.points.map((p) => periodLabel(p.period, period)),
      axisLine: { lineStyle: { color: NOTE.base } },
      axisTick: { show: false },
      axisLabel: { ...label, color: NOTE.text, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      scale: !bars,
      // Room above the bars for the note (Kevin 2026-11-09): the tallest bar stops at about 60% of the plot.
      ...(a && bars ? { max: (v: { max: number }) => v.max * 1.7 } : {}),
      // Lines too: free room above them for the note, which never covers a line (image-correction 2026-11-12).
      ...(a && !bars ? { max: (v: { max: number; min: number }) => v.max + (v.max - v.min) * 0.7 } : {}),
      splitNumber: 4,
      axisLabel: { ...label, formatter: (v: number) => fmtV(v) },
      splitLine: { lineStyle: { color: NOTE.grid } },
    },
    series: e.series.map((s, i) => {
      const colour = i === 0 ? NOTE.main : NOTE.palette[i % NOTE.palette.length];
      const raw = e.points.map((p) => p.values[s.key] ?? null);
      // With an annotation the lead series fades and its one point takes the tone's colour.
      const data =
        a && i === 0 && bars
          ? raw.map((v, k) => ({ value: v, itemStyle: { color: k === hit ? accent : NOTE.bench }, label: k === hit ? { color: accent, fontSize: 22 } : {} }))
          : raw;
      return bars
        ? {
            name: s.label,
            type: "bar",
            data,
            barMaxWidth: 64,
            itemStyle: { color: colour },
            label: { show: e.series.length === 1 && e.points.length <= 12, position: "top", color: "#fff", fontSize: 18, fontWeight: 600, fontFamily: FONT, formatter: (p: { value: number }) => fmtV(p.value) },
            labelLayout: { hideOverlap: true },
          }
        : {
            name: s.label,
            type: "line",
            data,
            symbol: "none",
            connectNulls: true,
            lineStyle: { color: colour, width: i === 0 ? 4 : 3 },
            itemStyle: { color: colour },
            endLabel: { show: i === 0, distance: 24, color: "#fff", fontSize: 20, fontWeight: 600, fontFamily: FONT, formatter: (p: { value: number }) => fmtV(p.value) },
            z: 3 - Math.min(i, 2),
          };
    }),
  });
  if (a) {
    const v = e.points[hit].values[lead.key];
    if (typeof v !== "number") throw new Error(`exhibit ${e.id} has no ${lead.label} value at ${a.point}`);
    const [px, py] = chart.convertToPixel({ seriesIndex: 0 }, [hit, v]) as number[];
    // A bar is hit in the middle of its body (its top carries the value label); a line point gets a ring.
    const base = (chart.convertToPixel({ seriesIndex: 0 }, [hit, 0]) as number[])[1];
    const band = (W - grid.left - grid.right) / e.points.length;
    const half = Math.min(64, band * 0.8) / 2;
    const [tx, ty] = bars ? [px - half - 6, (py + Math.min(base, H - grid.bottom)) / 2] : [px, py];
    // Every other bar with its value label on top is an obstacle for the note.
    const obstacles: Rect[] = bars
      ? e.points.flatMap((p, k) => {
          const val = p.values[lead.key];
          // The hit bar too: the note never sits on its value label (image-correction 2026-11-12: « hides its value label »).
          if (typeof val !== "number") return [];
          const [cx, top] = chart.convertToPixel({ seriesIndex: 0 }, [k, val]) as number[];
          return [{ x: cx - half - 30, y: Math.min(top, base) - 34, w: 2 * half + 60, h: Math.abs(base - top) + 34 }];
        })
      : lineObstacles(chart, e.series.map((s, i) => ({ index: i, values: e.points.map((p) => p.values[s.key]) })), (k, v) => [k, v]);
    chart.setOption({ graphic: [...(news && a.banner ? bannerGraphics(a.banner, newsBox) : []), ...calloutGraphics(tx, ty, a, accent, { left: grid.left, top: grid.top, right: W - 40, bottom: H - grid.bottom }, !bars, obstacles)] });
  }
  let svg = chart.renderToSVGString();
  chart.dispose();
  // The top right belongs to the price card when there is news: the mark moves to the bottom right.
  svg = news || pro ? withMark(svg, W - 56 - 40, H - 62, 40) : off ? withMark(svg, W - 56 - 56, 28, 56) : withMark(svg, W - 56 - 72, 40, 72);
  return card ? withCard(svg, signalCardSvg(input), W - 40 - CARD_W, cardY) : svg;
}

/** The 16:9 post card: the idea in words over the chart, deep indigo, the mark and the brand at the bottom. */
export function montageSvg(input: VisualInput, frame: Frame = FULL): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  const last = input.bars[input.bars.length - 1];
  chart.setOption({
    backgroundColor: INDIGO,
    animation: false,
    textStyle: { fontFamily: FONT },
    title: [
      { text: `${input.symbol}  ·  ${input.companyName ?? ""}`, left: 64, top: 44, textStyle: { color: LAVENDER, fontSize: 22, fontWeight: 400, fontFamily: FONT } },
      {
        text: input.title,
        left: 64,
        top: 84,
        textStyle: { color: "#fff", fontSize: 40, lineHeight: 52, fontWeight: 600, fontFamily: FONT, width: W - 128, overflow: "break" },
      },
      ...(input.fair && frame.reveal > 0
        ? [
            {
              text: `${fmt(last.close)} ${input.fair.currency ?? ""}  ·  ${gapWords(last.close, input.fair.value)}`,
              right: 64,
              bottom: 40,
              textStyle: { color: "#fff", fontSize: 22, fontWeight: 600, fontFamily: FONT, opacity: frame.reveal },
            },
          ]
        : []),
      { text: "Dualis Research", left: 112, bottom: 40, textStyle: { color: "#fff", fontSize: 22, fontWeight: 600, fontFamily: FONT } },
    ],
    grid: { left: 100, right: 220, top: 270, bottom: 110 },
    ...axes(input, true),
    series: series(input, frame, true),
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return withMark(svg, 64, H - 40 - 36, 36);
}

/**
 * An X Article cover (Kevin 2026-11-11): X shows Article covers at 5:2, so the whole 16:9 chart (title included) sits
 * centred on the chart's own ground at that ratio, never cropped.
 */
export const COVER_W = 2000;
export const COVER_H = 800;
export function coverSvg(chartPng: Buffer, chartW = W, chartH = H): string {
  const h = COVER_H;
  const w = Math.round((h * chartW) / chartH);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${COVER_W}" height="${COVER_H}" viewBox="0 0 ${COVER_W} ${COVER_H}"><rect width="${COVER_W}" height="${COVER_H}" fill="${NOTE.bg}"/><image x="${(COVER_W - w) / 2}" y="0" width="${w}" height="${h}" xlink:href="data:image/png;base64,${chartPng.toString("base64")}"/></svg>`;
}

export function png(svg: string): Buffer {
  const out = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: FONT } }).render().asPng();
  return Buffer.from(out);
}

/** Frames of the video: the line draws in 4 s, the fair value fades in over 1 s, then 2 s still. */
export function videoFrames(fps = 30): Frame[] {
  const draw = 4 * fps;
  const fade = 1 * fps;
  const hold = 2 * fps;
  return [
    ...Array.from({ length: draw }, (_, i) => ({ progress: (i + 1) / draw, reveal: 0 })),
    ...Array.from({ length: fade }, (_, i) => ({ progress: 1, reveal: (i + 1) / fade })),
    ...Array.from({ length: hold }, () => FULL),
  ];
}

/** MP4 of the card, frames piped to ffmpeg (`FFMPEG_PATH` or `ffmpeg` on the PATH). */
export async function video(input: VisualInput, fps = 30, ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg"): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "dualis-video-"));
  const out = join(dir, "card.mp4");
  try {
    const proc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", out], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let ended = false;
    proc.stderr.on("data", (d) => (stderr += d));
    // A missing ffmpeg or a crash mid-way ends `done` with the reason; the frame loop stops writing at once.
    const done = new Promise<void>((resolve, reject) => {
      proc.on("error", (err) => {
        ended = true;
        reject(new Error(`ffmpeg could not start (${ffmpeg}): ${err.message}`));
      });
      proc.on("close", (code) => {
        ended = true;
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
    // Writes into a pipe ffmpeg closed fail with EPIPE: `done` already carries the real reason.
    proc.stdin.on("error", () => undefined);
    for (const frame of videoFrames(fps)) {
      if (ended) break;
      if (!proc.stdin.write(png(montageSvg(input, frame)))) await Promise.race([new Promise((r) => proc.stdin.once("drain", r)), done.catch(() => undefined)]);
    }
    proc.stdin.end();
    await done;
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CARD_W = 400;
const CARD_H = 210;

/**
 * The price card pasted on the chart (Kevin 2026-11-09: « un collage du price et du range fair value, avec une flèche
 * directionnelle qui dit BUY signal »): white card, the 12-month price line, the fair value range as a band, and an arrow
 * from today's price toward the fair value saying the Signal (or the gap when there is none).
 */
export function signalCardSvg(input: VisualInput): string {
  const fair = input.fair;
  if (!fair) throw new Error("a price card needs a fair value");
  const last = input.bars[input.bars.length - 1];
  const up = last.close < fair.value;
  const colour = up ? COLOR.long.light : COLOR.short.light;
  const soft = up ? COLOR["long-soft"].light : COLOR["short-soft"].light;
  const lo = fair.low ?? fair.value;
  const hi = fair.high ?? fair.value;
  const values = [...input.bars.map((b) => b.close), lo, hi];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || max * 0.1;
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: CARD_W, height: CARD_H });
  const x0 = ts(input.bars[0].date);
  const x1 = ts(last.date);
  chart.setOption({
    backgroundColor: "#fff",
    animation: false,
    textStyle: { fontFamily: FONT },
    // A long company name would run off the card: the ticker stands in for it (Kevin 2026-11-12: words are never cut).
    title: { text: `${(input.companyName ?? input.symbol).length > 22 ? input.symbol : (input.companyName ?? input.symbol)}: share price vs fair value`, left: 16, top: 12, textStyle: { color: "#333", fontSize: 15, fontWeight: 600, fontFamily: FONT } },
    grid: { left: 16, right: 196, top: 44, bottom: 46 },
    xAxis: { type: "time", min: x0, max: x1, show: false },
    yAxis: { type: "value", min: Math.max(0, min - pad), max: max + pad, show: false },
    series: [
      {
        type: "line",
        data: input.bars.map((b) => [ts(b.date), b.close]),
        symbol: "none",
        lineStyle: { color: INDIGO, width: 3 },
        markArea: { silent: true, itemStyle: { color: soft }, data: [[{ yAxis: lo }, { yAxis: hi }]] },
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: colour, type: "dashed", width: 2 }, data: [{ yAxis: fair.value }] },
        z: 3,
      },
    ],
  });
  const [px, py] = chart.convertToPixel({ seriesIndex: 0 }, [x1, last.close]) as number[];
  const [, fy] = chart.convertToPixel({ seriesIndex: 0 }, [x1, fair.value]) as number[];
  const ax = px + 30;
  const pillX = ax + 18;
  const pillW = CARD_W - pillX - 14;
  const head = 14;
  const dir = fy < py ? -1 : 1;
  // No signal: the gap in two words (« 27% below »), the card already says « vs fair value »; the font shrinks until the
  // label fits its pill (Kevin 2026-11-12: « % below fair val » cut on both sides, the number lost).
  const label = input.signal ? `${input.signal} signal` : gapWords(last.close, fair.value).replace(/ fair value$/, "");
  const pillFont = Math.min(18, Math.floor((pillW - 16) / (label.length * 0.58)));
  chart.setOption({
    graphic: [
      { type: "circle", shape: { cx: px, cy: py, r: 6 }, style: { fill: INDIGO }, z: 10 },
      { type: "line", shape: { x1: ax, y1: py, x2: ax, y2: fy - dir * head }, style: { stroke: colour, lineWidth: 6 }, z: 10 },
      { type: "polygon", shape: { points: [[ax, fy], [ax - 12, fy - dir * head], [ax + 12, fy - dir * head]] }, style: { fill: colour }, z: 10 },
      { type: "rect", shape: { x: pillX, y: (py + fy) / 2 - 20, width: pillW, height: 40, r: 6 }, style: { fill: colour }, z: 10 },
      { type: "text", style: { text: label, x: pillX + pillW / 2, y: (py + fy) / 2, fill: "#fff", fontSize: pillFont, fontWeight: 600, fontFamily: FONT, align: "center", verticalAlign: "middle" }, z: 11 },
      { type: "text", style: { text: "Fair value", x: 22, y: fy - 12, fill: colour, fontSize: 13, fontWeight: 600, fontFamily: FONT, verticalAlign: "middle" }, z: 11 },
      // The gap to fair value as the opportunity (Kevin 2026-11-09: « Fair value X - X: NON, +N% opportunity en vert »).
      { type: "text", style: { text: opportunity(last.close, lo, hi, up), x: CARD_W - 16, y: CARD_H - 22, fill: colour, fontSize: 22, fontWeight: 600, fontFamily: FONT, align: "right", verticalAlign: "middle" }, z: 11 },
    ],
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

/**
 * The way to the fair value range as whole percents (Kevin 2026-11-09: « N-M% opportunity, N et M entiers, strictement
 * différents, strictement > 0 »): below fair value « +31-85% opportunity » (to the low, to the high of the range),
 * above it « 15-40% downside ». N is rounded down, M up, at least 1 and N + 1.
 */
export function opportunity(price: number, low: number, high: number, up: boolean): string {
  const near = up ? low / price - 1 : 1 - high / price;
  const far = up ? high / price - 1 : 1 - low / price;
  const n = Math.max(1, Math.floor(near * 100));
  const m = Math.max(n + 1, Math.ceil(far * 100));
  return up ? `+${n}-${m}% opportunity` : `${n}-${m}% downside`;
}

/** Pastes the price card on the chart, slightly turned like a cut-out, with a shadow. */
function withCard(svg: string, card: string, x: number, y: number): string {
  // As a PNG: resvg draws no text inside a nested SVG image (no fonts there). Twice the size for a sharp card.
  const b64 = Buffer.from(new Resvg(card, { fitTo: { mode: "zoom", value: 2 }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: FONT } }).render().asPng()).toString("base64");
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;
  return svg.replace(
    "</svg>",
    `<g transform="rotate(-2 ${cx} ${cy})"><rect x="${x + 6}" y="${y + 8}" width="${CARD_W}" height="${CARD_H}" fill="#000" fill-opacity="0.45"/><image href="data:image/png;base64,${b64}" x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"/></g></svg>`,
  );
}
