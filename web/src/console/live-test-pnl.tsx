"use client";

import { Slider } from "@cloudflare/kumo";
import { useMemo, useState } from "react";
import { DEFAULT_WEAK_WEIGHT, portfolioPnl, type PnlBenchmark, type PnlPosition } from "./live-test";
import type { Bar } from "./portfolio-series";
import { ReturnChart } from "./return-chart";

const pct = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)}%`);
const tone = (v: number | null) => (v === null ? "text-kumo-subtle" : v >= 0 ? "text-dualis-long" : "text-dualis-short");

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-kumo-subtle">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint && <span className="text-sm text-kumo-subtle">{hint}</span>}
    </div>
  );
}

/**
 * The book's P&L vs the S&P 500, computed in the browser for the weak weight the cursor sets (a strong entry = 1).
 * No server render per cursor move (Workers CPU rule).
 */
export function LivePnl({ positions, bars, benchmark, open, closed, won }: { positions: PnlPosition[]; bars: Record<string, Bar[]>; benchmark: PnlBenchmark; open: number; closed: number; won: number }) {
  const [weak, setWeak] = useState(DEFAULT_WEAK_WEIGHT);
  const pnl = useMemo(() => portfolioPnl(positions, bars, benchmark, weak), [positions, bars, benchmark, weak]);
  const vs = pnl.benchmarkReturn === null ? null : pnl.totalReturn - pnl.benchmarkReturn;
  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-wrap gap-10">
          <Stat label="Total return" value={<span className={`font-mono tabular ${tone(pnl.totalReturn)}`}>{pct(pnl.totalReturn)}</span>} />
          <Stat label="vs S&P 500" value={<span className={`font-mono tabular ${tone(vs)}`}>{pct(vs)}</span>} hint={`S&P 500 ${pct(pnl.benchmarkReturn)}`} />
          <Stat label="Open positions" value={<span className="font-mono tabular text-kumo-strong">{open}</span>} />
          <Stat label="Closed positions" value={<span className="font-mono tabular text-kumo-strong">{closed}</span>} hint={`${won} with a gain`} />
        </div>
        <div className="flex flex-col gap-2">
        <Slider
          label="Weight of a weak signal (strong = 1)"
          value={weak}
          onValueChange={(v) => setWeak(typeof v === "number" ? v : v[0])}
          min={0}
          max={1}
          step={0.05}
          className="w-72"
        />
        <p className="w-72 text-sm text-kumo-subtle">Each open position gets an equal share of the book. A weak one invests this part of its share, the rest stays in cash.</p>
        </div>
      </div>
      {pnl.lines.length > 0 && <ReturnChart lines={pnl.lines} />}
    </div>
  );
}
