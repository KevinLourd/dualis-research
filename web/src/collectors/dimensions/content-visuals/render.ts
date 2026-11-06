import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";
import type { VisualInput } from "./data";

/**
 * Node only (loaded by URL from the dimension: the console bundle never sees resvg or ffmpeg). Three pictures of an
 * Idea in the Dualis look: `chart` = the price against the fair value on black (his Note style: white line, grey
 * reference), `montage` = a 16:9 card on deep indigo with the idea in words above the chart and the mark in the
 * corner, `video` = the same card with the line drawing itself, then the fair value and the gap (MP4, H.264).
 */

export const W = 1280;
export const H = 720;
const FONT = "IBM Plex Sans";
const GREY = "#8a8a93";
const INDIGO = "#1A1640";
const LAVENDER = "#b9b4e0";
const asset = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const FONTS = [asset("../growth-brief/fonts/IBMPlexSans-Regular.ttf"), asset("../growth-brief/fonts/IBMPlexSans-SemiBold.ttf")];
const MARK = readFileSync(asset("../growth-brief/mark-white.svg")).toString("base64");

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 4 : Math.abs(v) >= 1000 ? 0 : 2 });
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
const monthLabel = (v: number) => new Date(v).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

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
      endLabel: { show: true, formatter: fmt(last.close), color: "#fff", fontSize: 22, fontWeight: 600, fontFamily: FONT },
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
      lineStyle: { color: onCard ? LAVENDER : GREY, width: 2, type: "dashed", opacity: frame.reveal },
      endLabel: {
        show: true,
        formatter: `Fair value ${fmt(f.value)}`,
        color: onCard ? LAVENDER : GREY,
        fontSize: 20,
        fontFamily: FONT,
        opacity: frame.reveal,
      },
      z: 2,
    });
  }
  return out;
}

function yRange(input: VisualInput) {
  const values = [...input.bars.map((b) => b.close), ...(input.fair ? [input.fair.value] : [])];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || hi * 0.1;
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

function axes(input: VisualInput, onCard: boolean) {
  const { min, max } = yRange(input);
  const label = { color: onCard ? LAVENDER : GREY, fontSize: 18, fontFamily: FONT };
  return {
    xAxis: {
      type: "time" as const,
      min: ts(input.bars[0].date),
      max: ts(input.bars[input.bars.length - 1].date),
      axisLine: { lineStyle: { color: onCard ? "#3a3470" : "#333" } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { ...label, formatter: (v: number) => monthLabel(v) },
      splitNumber: 6,
    },
    yAxis: {
      type: "value" as const,
      min,
      max,
      splitNumber: 4,
      // Round ticks only: the padded min and max would print odd values (1.59, 3.46).
      axisLabel: { ...label, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => fmt(v) },
      splitLine: { lineStyle: { color: onCard ? "#25205a" : "#1c1c1f" } },
    },
  };
}

function withMark(svg: string, x: number, y: number, size: number): string {
  return svg.replace("</svg>", `<image href="data:image/svg+xml;base64,${MARK}" x="${x}" y="${y}" width="${size}" height="${size}"/></svg>`);
}

/** Price vs fair value on black: the exhibit. */
export function chartSvg(input: VisualInput, frame: Frame = FULL): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  const last = input.bars[input.bars.length - 1];
  chart.setOption({
    backgroundColor: "#000",
    animation: false,
    textStyle: { fontFamily: FONT },
    title: [
      { text: `${input.companyName ?? input.symbol} share price vs fair value`, left: 56, top: 44, textStyle: { color: "#fff", fontSize: 34, fontWeight: 600, fontFamily: FONT } },
      {
        text: input.fair ? `Last 12 months · ${gapWords(last.close, input.fair.value)} · fair value ${fmt(input.fair.value)} ${input.fair.currency ?? ""}` : "Last 12 months",
        left: 56,
        top: 94,
        textStyle: { color: GREY, fontSize: 22, fontWeight: 400, fontFamily: FONT },
      },
      { text: `Source: ${input.priceSources.join(", ")}, Dualis Research`, left: 56, bottom: 28, textStyle: { color: GREY, fontSize: 16, fontWeight: 400, fontFamily: FONT } },
    ],
    grid: { left: 96, right: 200, top: 160, bottom: 92 },
    ...axes(input, false),
    series: series(input, frame, false),
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return withMark(svg, W - 56 - 72, 40, 72);
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
