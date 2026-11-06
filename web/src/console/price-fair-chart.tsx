"use client";

import { Chart, Tabs } from "@cloudflare/kumo";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useMemo, useState } from "react";
import { FONT, INK, SOURCE_LABEL } from "./driver-chart";
import { monthYear } from "./exhibit-format";
import { usePageDark } from "./use-page-dark";

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, AriaComponent, CanvasRenderer]);

/**
 * The picture above the Narrative: the daily close against the Fair Value, research-note look (same ink as the
 * Exhibits). Above the fair value = SELL zone, below = BUY zone, in faint tints. The fair value is a reference line
 * labelled with the day it was set (gold keeps no earlier values); only reported closes are drawn.
 */

export type FairLine = { value: number; currency: string | null; author: "thierry" | "claude"; since: string | null; claudeValue: number | null; low: number | null; high: number | null };
type Range = "6M" | "1Y" | "5Y";
const MONTHS: Record<Range, number> = { "6M": 6, "1Y": 12, "5Y": 60 };
const ZONE = { buy: "rgba(22, 128, 61, 0.06)", sell: "rgba(190, 18, 60, 0.06)", range: "rgba(43, 36, 99, 0.10)" };

const fmtNum = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 4 : Math.abs(v) >= 1000 ? 0 : 2 });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function startOf(last: string, months: number): string {
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function PriceFairValueChart({
  symbol,
  bars,
  fair,
  currency,
  sources,
}: {
  symbol: string;
  bars: { date: string; close: number }[];
  fair: FairLine | null;
  currency: string | null;
  sources: string[];
}) {
  const dark = usePageDark();
  const [range, setRange] = useState<Range>("1Y");

  const last = bars.at(-1);
  // 5Y only when the history goes past one year (it shows as far as the closes go).
  const ranges: Range[] = last && bars[0].date < startOf(last.date, 13) ? ["6M", "1Y", "5Y"] : ["6M", "1Y"];
  const shown = useMemo(() => (last ? bars.filter((b) => b.date >= startOf(last.date, MONTHS[range])) : []), [bars, last, range]);
  if (!last) return null;

  const ink = dark ? INK.dark : INK.light;
  const text = { fontFamily: FONT, fontSize: 11, color: ink.muted };
  const closes = shown.map((b) => b.close);
  const fvRange = fair && fair.low !== null && fair.high !== null ? { low: fair.low, high: fair.high } : null;
  const levels = [...closes, ...(fair ? [fair.value] : []), ...(fair?.claudeValue ? [fair.claudeValue] : []), ...(fvRange ? [fvRange.low, fvRange.high] : [])];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const pad = (hi - lo) * 0.08 || hi * 0.05;
  const yMin = Math.max(0, lo - pad);
  const yMax = hi + pad;
  const fairLabel = fair ? (fair.author === "thierry" ? "Your fair value" : "Fair value (Claude)") : null;
  const gap = fair ? last.close / fair.value - 1 : null;

  const markLines = fair
    ? [
        {
          yAxis: fair.value,
          lineStyle: { color: ink.navy, width: 1.5, type: "dashed" },
          label: { show: true, position: "insideEndTop", fontFamily: FONT, fontSize: 10, color: ink.text, formatter: `${fairLabel} ${fmtNum(fair.value)}` },
        },
        // The fair value range (Kevin 2026-11-06: « montre le range, pas que la FV »): its low and high, dotted.
        ...(fvRange
          ? [
              { yAxis: fvRange.high, lineStyle: { color: ink.navy, width: 1, type: "dotted" }, label: { show: true, position: "insideEndTop", fontFamily: FONT, fontSize: 10, color: ink.muted, formatter: `High ${fmtNum(fvRange.high)}` } },
              { yAxis: fvRange.low, lineStyle: { color: ink.navy, width: 1, type: "dotted" }, label: { show: true, position: "insideEndBottom", fontFamily: FONT, fontSize: 10, color: ink.muted, formatter: `Low ${fmtNum(fvRange.low)}` } },
            ]
          : []),
        ...(fair.claudeValue
          ? [{ yAxis: fair.claudeValue, lineStyle: { color: ink.muted, width: 1, type: "dotted" }, label: { show: true, position: "insideEndBottom", fontFamily: FONT, fontSize: 10, color: ink.muted, formatter: `Claude ${fmtNum(fair.claudeValue)}` } }]
        : []),
      ]
    : [];

  const options = {
    animation: false,
    textStyle: { fontFamily: FONT },
    grid: { left: 0, right: 16, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: ink.muted, width: 1 } },
      backgroundColor: dark ? "#16191d" : "#ffffff",
      borderColor: ink.grid,
      borderWidth: 1,
      textStyle: { fontFamily: FONT, fontSize: 12, color: ink.text },
      valueFormatter: (v: number) => `${fmtNum(v)}${currency ? ` ${currency}` : ""}`,
    },
    xAxis: {
      type: "time",
      axisLine: { show: true, onZero: false, lineStyle: { color: ink.axis, width: 1 } },
      axisTick: { show: true, lineStyle: { color: ink.axis } },
      axisLabel: { ...text, color: ink.text, hideOverlap: true, formatter: (t: number) => monthYear(new Date(t).toISOString().slice(0, 10)) },
      splitNumber: 6,
      splitLine: { show: false },
    },
    yAxis: { type: "value", min: yMin, max: yMax, axisLine: { show: false }, axisTick: { show: false }, splitNumber: 4, splitLine: { lineStyle: { color: ink.grid, width: 1 } }, axisLabel: { ...text, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => fmtNum(v) } },
    series: [
      {
        name: "Close",
        type: "line",
        data: shown.map((b) => [Date.parse(`${b.date}T00:00:00Z`), b.close]),
        showSymbol: false,
        lineStyle: { color: ink.navy, width: 1.5 },
        itemStyle: { color: ink.navy },
        markLine: fair ? { silent: true, symbol: "none", data: markLines } : undefined,
        markArea: fair
          ? {
              silent: true,
              data: [
                [{ yAxis: fair.value, itemStyle: { color: ZONE.sell }, label: { show: true, position: "insideTopLeft", fontFamily: FONT, fontSize: 10, color: ink.muted, formatter: "SELL zone" } }, { yAxis: yMax }],
                [{ yAxis: yMin, itemStyle: { color: ZONE.buy }, label: { show: true, position: "insideBottomLeft", fontFamily: FONT, fontSize: 10, color: ink.muted, formatter: "BUY zone" } }, { yAxis: fair.value }],
                ...(fvRange ? [[{ yAxis: fvRange.low, itemStyle: { color: ZONE.range } }, { yAxis: fvRange.high }]] : []),
              ],
            }
          : undefined,
      },
    ],
    aria: { enabled: true },
  };

  return (
    <figure className="flex flex-col gap-1" style={{ fontFamily: FONT }}>
      <figcaption className="flex flex-wrap items-end justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-[13px] font-bold text-kumo-strong">
            {symbol}: price vs fair value
          </span>
          <span className="text-[11px] text-kumo-subtle">
            Daily close{currency ? `, ${currency}` : ""}, {day(shown[0].date)} to {day(last.date)}
          </span>
        </span>
        <Tabs variant="segmented" size="sm" value={range} onValueChange={(v) => setRange(v as Range)} tabs={ranges.map((r) => ({ value: r, label: r }))} />
      </figcaption>
      <div className="border-t border-kumo-line pt-1">
        <Chart echarts={echarts} options={options as never} height={240} isDarkMode={dark} />
      </div>
      <p className="text-[12px] text-kumo-default">
        {fair && gap !== null ? (
          <>
            Last close {fmtNum(last.close)} is {Math.abs(Math.round(gap * 100))}% {gap < 0 ? "below" : "above"} {fair.author === "thierry" ? "your fair value" : "the fair value (Claude)"} of {fmtNum(fair.value)}
            {fvRange ? ` (range ${fmtNum(fvRange.low)} to ${fmtNum(fvRange.high)})` : ""}
            {fair.since ? `, set ${day(fair.since)}` : ""}: {gap < 0 ? "BUY zone" : "SELL zone"}.
          </>
        ) : (
          "No fair value yet: the line appears once the analysis sets one."
        )}
      </p>
      <p className="border-t border-kumo-hairline pt-1 text-[10px] text-kumo-subtle">
        Source: {sources.map((s) => SOURCE_LABEL[s] ?? s).join("; ") || "not collected"}; Dualis Research.
      </p>
    </figure>
  );
}
