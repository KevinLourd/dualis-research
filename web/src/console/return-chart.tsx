"use client";

import { TimeseriesChart } from "@cloudflare/kumo";
import { LineChart } from "echarts/charts";
import { AriaComponent, BrushComponent, GridComponent, MarkLineComponent, ToolboxComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import type { Line } from "./portfolio-series";
import { FitWidth } from "./fit-width";
import { usePageDark } from "./use-page-dark";
import { COLOR } from "@/design/tokens";

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, AriaComponent, BrushComponent, ToolboxComponent, CanvasRenderer]);

/** Dualis indigo family = the portfolio or each position; grey = the S&P 500. */
const POSITION = { light: [COLOR["brand-chart"].light, "#2f6fd6", "#0f8a8a", "#7a4fd6"], dark: [COLOR["brand-chart"].dark, "#8fb8ff", "#4fc4c4", "#b59cff"] };
const BENCHMARK = { light: "#6b7280", dark: "#9aa1ab" };

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)}%`;

/** Cumulative return since entry: the portfolio (or each position) against the S&P 500 over the same dates. */
export function ReturnChart({ lines }: { lines: Line[] }) {
  const dark = usePageDark();
  const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const palette = dark ? POSITION.dark : POSITION.light;
  let i = 0;
  const data = lines.map((l) => ({
    name: l.name,
    color: l.kind === "benchmark" ? (dark ? BENCHMARK.dark : BENCHMARK.light) : palette[i++ % palette.length],
    data: l.points.map((p) => [ts(p.date), p.value] as [number, number]),
  }));
  const summary = lines.map((l) => `${l.name} ${pct(l.points.at(-1)?.value ?? 0)}`).join(", ");
  return (
    <div className="flex flex-col gap-3">
    <FitWidth><TimeseriesChart
      echarts={echarts}
      isDarkMode={dark}
      height={320}
      data={data}
      yAxisTickFormat={pct}
      tooltipValueFormat={pct}
      xAxisTickFormat={(t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
      tooltipTimestampFormat={(t) => new Date(t).toISOString().slice(0, 10)}
      xAxisTickCount={6}
      yAxisTickCount={5}
      ariaDescription={`Return since entry: ${summary}.`}
    /></FitWidth>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {lines.map((l, k) => (
          <li key={l.name} className="inline-flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: data[k].color }} />
            <span className="text-kumo-default">{l.name}</span>
            <span className="font-mono tabular text-kumo-subtle">{pct(l.points.at(-1)?.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
