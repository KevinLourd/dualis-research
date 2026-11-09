import { positionReturn } from "@/content/signal-words";
import type { Bar, Line } from "./portfolio-series";

/**
 * Live test (Kevin 2026-11-09): what following the Signal would have returned, replayed from the stored signal history.
 * Pure, so the page and the tests share it. Zero transaction costs, spread or slippage (owner: « on néglige tous les
 * coûts de transaction »). Entry and exit at the close of the signal day (or the next close there is); an open position
 * is marked to the latest close. Returns are in each ticker's own currency.
 */

export type SignalState = { symbol: string; signal: "BUY" | "SELL" | "none"; strength: "strong" | "weak" | "noise"; at: Date };

export const STRATEGIES = {
  all: { label: "All signals", description: "Every signal, weak or strong, equal weight. Out once the ticker has no signal." },
  strong: { label: "Strong only", description: "Strong signals only, equal weight. Out once the ticker has no signal." },
  "strong-x2": { label: "Strong x2", description: "Every signal, a strong entry weighs twice a weak one. Out once the ticker has no signal." },
} as const;
export type StrategyId = keyof typeof STRATEGIES;

export type Trade = {
  symbol: string;
  side: "long" | "short";
  strength: "strong" | "weak";
  /** Allocation units: 2 for a strong entry in Strong x2, else 1. */
  units: number;
  signalDate: string;
  /** The close the position entered at; null until that close exists. */
  entryDate: string | null;
  entryPrice: number | null;
  /** Null while open. */
  exitDate: string | null;
  exitPrice: number | null;
  /** The close the return is read on: the exit, else the latest close. */
  markDate: string | null;
  markPrice: number | null;
  return: number | null;
  open: boolean;
  /** Share of the portfolio on the latest day (open positions only). */
  weight: number | null;
};

export type LiveTest = {
  trades: Trade[];
  lines: Line[];
  stats: {
    totalReturn: number;
    benchmarkReturn: number | null;
    trades: number;
    closed: number;
    winners: number | null;
    best: { symbol: string; return: number } | null;
    worst: { symbol: string; return: number } | null;
  };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** First close on or after `date`. */
function closeOnOrAfter(bars: Bar[], date: string): Bar | null {
  return bars.find((b) => b.date >= date) ?? null;
}

/** The trades one strategy opens from one ticker's ordered states (no prices yet). */
function replayTicker(states: SignalState[], strategy: StrategyId) {
  const out: { side: "long" | "short"; strength: "strong" | "weak"; signalDate: string; exitSignalDate: string | null }[] = [];
  let open: (typeof out)[number] | null = null;
  for (const s of states) {
    const side = s.signal === "BUY" ? "long" : s.signal === "SELL" ? "short" : null;
    const date = ymd(s.at);
    if (open && open.side !== side) {
      // No signal any more, or the other side: out. Strong -> weak on the same side keeps the position.
      open.exitSignalDate = date;
      open = null;
    }
    if (!open && side) {
      const strength = s.strength === "strong" ? "strong" : "weak";
      if (strategy === "strong" && strength !== "strong") continue;
      open = { side, strength, signalDate: date, exitSignalDate: null };
      out.push(open);
    }
  }
  return out;
}

/** Replays one strategy over every ticker's signal history and daily closes. */
export function replayStrategy(
  states: SignalState[],
  bars: Map<string, Bar[]>,
  benchmark: Bar[],
  strategy: StrategyId,
): LiveTest {
  const bySymbol = new Map<string, SignalState[]>();
  for (const s of [...states].sort((a, b) => a.at.getTime() - b.at.getTime())) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
  const start = states.length ? ymd(new Date(Math.min(...states.map((s) => s.at.getTime())))) : null;

  const trades: Trade[] = [];
  for (const [symbol, list] of bySymbol) {
    const b = bars.get(symbol) ?? [];
    const last = b.at(-1) ?? null;
    for (const t of replayTicker(list, strategy)) {
      const entry = closeOnOrAfter(b, t.signalDate);
      const exit = t.exitSignalDate ? closeOnOrAfter(b, t.exitSignalDate) : null;
      const open = t.exitSignalDate === null;
      const mark = open ? last : (exit ?? last);
      trades.push({
        symbol,
        side: t.side,
        strength: t.strength,
        units: strategy === "strong-x2" && t.strength === "strong" ? 2 : 1,
        signalDate: t.signalDate,
        entryDate: entry?.date ?? null,
        entryPrice: entry?.close ?? null,
        exitDate: open ? null : (exit?.date ?? t.exitSignalDate),
        exitPrice: exit?.close ?? null,
        markDate: entry ? (mark?.date ?? null) : null,
        markPrice: entry ? (mark?.close ?? null) : null,
        return: entry && mark ? positionReturn(entry.close, mark.close, t.side) : null,
        open,
        weight: null,
      });
    }
  }
  trades.sort((a, b) => b.signalDate.localeCompare(a.signalDate) || a.symbol.localeCompare(b.symbol));

  // Portfolio: each day, the open positions share the book by units; it compounds their day returns.
  const priced = trades.filter((t) => t.entryDate !== null);
  const days = start
    ? [...new Set([...priced.flatMap((t) => (bars.get(t.symbol) ?? []).map((x) => x.date)), ...benchmark.map((x) => x.date)])].filter((d) => d >= start).sort()
    : [];
  const closeAt = (symbol: string, d: string) => {
    let c: number | null = null;
    for (const x of bars.get(symbol) ?? []) {
      if (x.date > d) break;
      c = x.close;
    }
    return c;
  };
  let equity = 1;
  const points = days.map((d, i) => {
    if (i > 0) {
      const prev = days[i - 1];
      let sum = 0;
      let units = 0;
      for (const t of priced) {
        // Held over (prev, d]: entered at or before prev, not exited before d.
        if (t.entryDate! > prev) continue;
        if (t.exitDate !== null && t.exitDate <= prev) continue;
        const a = closeAt(t.symbol, prev);
        const z = closeAt(t.symbol, t.exitDate !== null && t.exitDate < d ? t.exitDate : d);
        if (a === null || z === null) continue;
        sum += t.units * positionReturn(a, z, t.side)!;
        units += t.units;
      }
      if (units > 0) equity *= 1 + sum / units;
    }
    return { date: d, value: equity - 1 };
  });

  const openUnits = priced.filter((t) => t.open).reduce((s, t) => s + t.units, 0);
  for (const t of priced) if (t.open) t.weight = t.units / openUnits;

  const lines: Line[] = [];
  if (points.length) lines.push({ name: STRATEGIES[strategy].label, kind: "portfolio", points });
  const base = start ? closeOnOrAfter(benchmark, start) : null;
  if (base) lines.push({ name: "S&P 500", kind: "benchmark", points: benchmark.filter((x) => x.date >= base.date).map((x) => ({ date: x.date, value: x.close / base.close - 1 })) });

  const perTicker = new Map<string, number>();
  for (const t of trades) if (t.return !== null) perTicker.set(t.symbol, (perTicker.get(t.symbol) ?? 1) * (1 + t.return));
  const ranked = [...perTicker].map(([symbol, g]) => ({ symbol, return: g - 1 })).sort((a, b) => b.return - a.return);
  const withReturn = trades.filter((t) => t.return !== null);
  const benchLine = lines.find((l) => l.kind === "benchmark");
  return {
    trades,
    lines,
    stats: {
      totalReturn: equity - 1,
      benchmarkReturn: benchLine ? benchLine.points.at(-1)!.value : null,
      trades: trades.length,
      closed: trades.filter((t) => !t.open).length,
      winners: withReturn.length ? withReturn.filter((t) => t.return! > 0).length / withReturn.length : null,
      best: ranked[0] ?? null,
      worst: ranked.length > 1 ? ranked.at(-1)! : null,
    },
  };
}
