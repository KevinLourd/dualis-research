"use client";

import { Chart } from "@cloudflare/kumo";
import { BarChart, ScatterChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { FONT, INK } from "./driver-chart";
import { usePageDark } from "./use-page-dark";

echarts.use([BarChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);

/**
 * The football field (how sell-side research shows a valuation): one horizontal bar per method from its low to its high
 * value per share, a dot on its base case, the weighted Fair Value as the last bar, the quote as a vertical line.
 */
export type FieldRow = { label: string; low: number; base: number; high: number; weight: number | null; total?: boolean };

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });

export function FootballField({ rows, quote, currency }: { rows: FieldRow[]; quote: number | null; currency: string | null }) {
  const dark = usePageDark();
  const ink = dark ? INK.dark : INK.light;
  const text = { fontFamily: FONT, fontSize: 11, color: ink.text };
  const shown = [...rows].reverse();
  const options = {
    animation: false,
    textStyle: { fontFamily: FONT },
    grid: { left: 0, right: 24, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#16191d" : "#ffffff",
      borderColor: ink.grid,
      textStyle: { fontFamily: FONT, fontSize: 12, color: ink.text },
      formatter: (p: { dataIndex: number }) => {
        const r = shown[p.dataIndex];
        return `${r.label}<br/>${fmt(r.low)} to ${fmt(r.high)}, base ${fmt(r.base)}${currency ? ` ${currency}` : ""}${r.weight !== null ? `<br/>weight ${Math.round(r.weight * 100)}%` : ""}`;
      },
    },
    xAxis: { type: "value", scale: true, axisLine: { show: true, lineStyle: { color: ink.axis } }, splitLine: { lineStyle: { color: ink.grid } }, axisLabel: { ...text, formatter: (v: number) => fmt(v) } },
    yAxis: { type: "category", data: shown.map((r) => (r.weight !== null && !r.total ? `${r.label} (${Math.round(r.weight * 100)}%)` : r.label)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...text, fontWeight: 400 } },
    series: [
      { type: "bar", stack: "range", silent: true, itemStyle: { color: "transparent" }, data: shown.map((r) => r.low), barWidth: 14 },
      {
        type: "bar",
        stack: "range",
        data: shown.map((r) => ({ value: r.high - r.low, itemStyle: { color: r.total ? ink.navy : r.weight ? `${ink.navy}88` : `${ink.muted}55` } })),
        barWidth: 14,
        markLine:
          quote !== null
            ? { silent: true, symbol: "none", lineStyle: { color: ink.text, type: "dashed", width: 1 }, label: { formatter: `Quote ${fmt(quote)}`, fontFamily: FONT, fontSize: 10, color: ink.text, position: "end" }, data: [{ xAxis: quote }] }
            : undefined,
      },
      { type: "scatter", data: shown.map((r, i) => [r.base, i]), symbolSize: 9, itemStyle: { color: dark ? "#ffffff" : "#111827", borderColor: ink.navy, borderWidth: 1 }, z: 3 },
    ],
    aria: { enabled: true },
  };
  return (
    <figure className="flex flex-col gap-1" style={{ fontFamily: FONT }}>
      <figcaption className="flex flex-col">
        <span className="text-[13px] font-bold text-kumo-strong">Valuation range by method</span>
        <span className="text-[11px] text-kumo-subtle">Value per share{currency ? `, ${currency}` : ""}: low to high, dot = base case, weight in brackets</span>
      </figcaption>
      <div className="border-t border-kumo-line pt-1">
        <Chart echarts={echarts} options={options as never} height={Math.max(160, 44 * rows.length + 40)} isDarkMode={dark} />
      </div>
    </figure>
  );
}
