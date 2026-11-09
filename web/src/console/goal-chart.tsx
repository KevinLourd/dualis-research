"use client";

import { TimeseriesChart } from "@cloudflare/kumo";
import { LineChart } from "echarts/charts";
import { AriaComponent, BrushComponent, GridComponent, MarkLineComponent, ToolboxComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { FitWidth } from "./fit-width";
import { usePageDark } from "./use-page-dark";

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, AriaComponent, BrushComponent, ToolboxComponent, CanvasRenderer]);

const NAVY = { light: "#2b2463", dark: "#5b53a8" };
const LINE = "#94a3b8";

/** Thierry's subscribers per day against the straight line to the goal. */
export function GoalChart({ actual, plan }: { actual: { date: string; value: number }[]; plan: { date: string; value: number }[] }) {
  const dark = usePageDark();
  const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const fmt = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));
  const last = actual.at(-1);
  return (
    <FitWidth><TimeseriesChart
      echarts={echarts}
      isDarkMode={dark}
      height={220}
      data={[
        { name: "Subscribers", color: dark ? NAVY.dark : NAVY.light, data: actual.map((p) => [ts(p.date), p.value]) },
        { name: "Goal line", color: LINE, data: plan.map((p) => [ts(p.date), p.value]) },
      ]}
      yAxisTickFormat={fmt}
      tooltipValueFormat={fmt}
      tooltipTimestampFormat={(t) => new Date(t).toISOString().slice(0, 10)}
      xAxisTickCount={5}
      yAxisTickCount={4}
      ariaDescription={last ? `Subscribers: ${fmt(last.value)} on ${last.date}, goal ${fmt(plan.at(-1)?.value ?? 0)} by ${plan.at(-1)?.date}.` : "No subscriber count yet"}
    /></FitWidth>
  );
}
