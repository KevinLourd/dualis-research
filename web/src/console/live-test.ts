import { positionReturn } from "@/content/signal-words";
import type { Bar, Line } from "./portfolio-series";

/**
 * Live test (Kevin 2026-11-09): what following the Signal would have returned, replayed from the stored signal history.
 * Pure, so the page and the tests share it. Zero transaction costs, spread or slippage (owner: « on néglige tous les
 * coûts de transaction »). Entry and exit at the price known when the signal fired = the last close its market had
 * printed by then (Kevin 2026-11-09: a signal on Sunday trades at Friday's close, never at Monday's); an open position is
 * worth the current price = the latest close stored (refreshed every 4 hours). Returns are in each ticker's own currency.
 */

export type SignalState = { symbol: string; signal: "BUY" | "SELL" | "none"; strength: "strong" | "weak" | "noise"; at: Date };

/** When each market's daily close prints, in UTC (regular session end; November = standard time in Europe and the US). */
const CLOSE_UTC: Record<string, string> = { US: "21:00", CA: "21:00", JP: "06:30", KR: "06:30", HK: "08:00", AU: "05:00", UK: "16:30", EU: "16:30" };

/** The last close of `market` already printed at `at`: the price a trade at that moment gets. */
export function closeKnownAt(bars: Bar[], at: Date, market: string): Bar | null {
  const hhmm = CLOSE_UTC[market];
  if (!hhmm) throw new Error(`live test: no close time for market ${market}`);
  let known: Bar | null = null;
  for (const b of bars) {
    if (Date.parse(`${b.date}T${hhmm}:00Z`) > at.getTime()) break;
    known = b;
  }
  return known;
}

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
  /** The close the position entered at (the last one printed when the signal fired); null when none is stored. */
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
    /** Trades whose price has not moved since entry yet (opened and closed on the same close, or no new close). */
    flat: number;
    best: { symbol: string; return: number } | null;
    worst: { symbol: string; return: number } | null;
  };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The trades one strategy opens from one ticker's ordered states (no prices yet). */
function replayTicker(states: SignalState[], strategy: StrategyId) {
  const out: { side: "long" | "short"; strength: "strong" | "weak"; signalAt: Date; exitAt: Date | null }[] = [];
  let open: (typeof out)[number] | null = null;
  for (const s of states) {
    const side = s.signal === "BUY" ? "long" : s.signal === "SELL" ? "short" : null;
    if (open && open.side !== side) {
      // No signal any more, or the other side: out. Strong -> weak on the same side keeps the position.
      open.exitAt = s.at;
      open = null;
    }
    if (!open && side) {
      const strength = s.strength === "strong" ? "strong" : "weak";
      if (strategy === "strong" && strength !== "strong") continue;
      open = { side, strength, signalAt: s.at, exitAt: null };
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
  markets: Map<string, string>,
  strategy: StrategyId,
): LiveTest {
  const bySymbol = new Map<string, SignalState[]>();
  for (const s of [...states].sort((a, b) => a.at.getTime() - b.at.getTime())) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
  const firstAt = states.length ? new Date(Math.min(...states.map((s) => s.at.getTime()))) : null;
  const start = firstAt ? ymd(firstAt) : null;

  const trades: Trade[] = [];
  for (const [symbol, list] of bySymbol) {
    const b = bars.get(symbol) ?? [];
    const last = b.at(-1) ?? null;
    const market = markets.get(symbol);
    if (!market) throw new Error(`live test: no market for ${symbol}`);
    for (const t of replayTicker(list, strategy)) {
      const entry = closeKnownAt(b, t.signalAt, market);
      const exit = t.exitAt ? closeKnownAt(b, t.exitAt, market) : null;
      const open = t.exitAt === null;
      const mark = open ? last : exit;
      trades.push({
        symbol,
        side: t.side,
        strength: t.strength,
        units: strategy === "strong-x2" && t.strength === "strong" ? 2 : 1,
        signalDate: ymd(t.signalAt),
        entryDate: entry?.date ?? null,
        entryPrice: entry?.close ?? null,
        exitDate: open ? null : (exit?.date ?? ymd(t.exitAt!)),
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
    ? [...new Set([...priced.flatMap((t) => (bars.get(t.symbol) ?? []).map((x) => x.date)), ...benchmark.map((x) => x.date)])]
        .filter((d) => d >= [start, ...priced.map((t) => t.entryDate!)].sort()[0])
        .sort()
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
  const base = firstAt ? (closeKnownAt(benchmark, firstAt, "US") ?? benchmark[0] ?? null) : null;
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
      flat: withReturn.filter((t) => t.return === 0).length,
      // Named only when tickers differ: a tie (every trade flat so far) has no best or worst.
      best: ranked.length > 1 && ranked[0].return > ranked.at(-1)!.return ? ranked[0] : ranked.length === 1 ? ranked[0] : null,
      worst: ranked.length > 1 && ranked[0].return > ranked.at(-1)!.return ? ranked.at(-1)! : null,
    },
  };
}
