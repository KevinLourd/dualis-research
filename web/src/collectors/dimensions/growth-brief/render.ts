import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";
import { GOAL } from "@/growth/goal";
import { dayLabel, type GrowthBrief } from "@/growth/daily";

/**
 * The brief's chart as a PNG (Node only: loaded by URL from the dimension so the console bundle never sees resvg).
 * Dualis black chart style: subscribers in white, the goal line in grey, the seal small in the corner (never a
 * background watermark here: Kevin 2026-11-06).
 */

const W = 1200;
const H = 800;
const GREY = "#8a8a93";
const FONT = "IBM Plex Sans";
const asset = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function briefChartSvg(b: GrowthBrief): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: W, height: H });
  const top = Math.ceil(GOAL.target / 400) * 400;
  chart.setOption({
    backgroundColor: "#000",
    animation: false,
    textStyle: { fontFamily: FONT },
    title: [
      { text: "Analysis Paralysis subscribers", left: 64, top: 52, textStyle: { color: GREY, fontSize: 26, fontWeight: 400, fontFamily: FONT } },
      { text: fmt(b.current), left: 64, top: 92, textStyle: { color: "#fff", fontSize: 88, fontWeight: 600, fontFamily: FONT } },
      {
        text: `${b.gained >= 0 ? "+" : ""}${fmt(b.gained)} since ${dayLabel(GOAL.startDate)}   ·   goal ${fmt(GOAL.target)} by ${dayLabel(GOAL.endDate)}   ·   ${fmt(b.perDayNeeded)} a day needed`,
        left: 64,
        top: 204,
        textStyle: { color: GREY, fontSize: 24, fontWeight: 400, fontFamily: FONT },
      },
    ],
    grid: { left: 110, right: 160, top: 280, bottom: 70 },
    xAxis: {
      type: "time",
      min: ts(GOAL.startDate),
      max: ts(GOAL.endDate),
      axisLine: { lineStyle: { color: "#333" } },
      splitLine: { show: false },
      axisLabel: { color: GREY, fontSize: 20, fontFamily: FONT, formatter: (v: number) => dayLabel(new Date(v).toISOString().slice(0, 10)) },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: top,
      interval: 400,
      axisLabel: { color: GREY, fontSize: 20, fontFamily: FONT, formatter: (v: number) => fmt(v) },
      splitLine: { lineStyle: { color: "#1c1c1f" } },
    },
    series: [
      {
        name: "Goal line",
        type: "line",
        data: b.plan.map((p) => [ts(p.date), p.value]),
        symbol: "none",
        lineStyle: { color: GREY, width: 2, type: "dashed" },
        endLabel: { show: true, formatter: `Goal ${fmt(GOAL.target)}`, color: GREY, fontSize: 20, fontFamily: FONT },
      },
      {
        name: "Subscribers",
        type: "line",
        data: b.actual.map((p) => [ts(p.date), p.value]),
        symbol: "circle",
        symbolSize: 10,
        lineStyle: { color: "#fff", width: 4 },
        itemStyle: { color: "#fff" },
        endLabel: { show: true, formatter: fmt(b.current), color: "#fff", fontSize: 22, fontWeight: 600, fontFamily: FONT },
      },
    ],
  });
  const svg = chart.renderToSVGString();
  chart.dispose();
  const seal = readFileSync(asset("../../../../public/brand/seal-white.svg")).toString("base64");
  const size = 96;
  return svg.replace("</svg>", `<image href="data:image/svg+xml;base64,${seal}" x="${W - 64 - size}" y="48" width="${size}" height="${size}"/></svg>`);
}

export function briefChartPng(b: GrowthBrief): Buffer {
  const png = new Resvg(briefChartSvg(b), {
    font: {
      loadSystemFonts: false,
      fontFiles: [asset("./fonts/IBMPlexSans-Regular.ttf"), asset("./fonts/IBMPlexSans-SemiBold.ttf")],
      defaultFontFamily: FONT,
    },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}
