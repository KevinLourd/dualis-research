import { positionReturn } from "@/content/signal-words";
import type { Bar, Line } from "./portfolio-series";

/**
 * Live test (Kevin 2026-11-09): what following the Signal would have returned. Pure, so the `signals` collector (which
 * stores the positions), the page and the tests share it. No trading costs, spread or slippage (owner: « on néglige tous
 * les coûts de transaction »).
 *
 * Positions: every BUY (long) or SELL (short) reading opens one; the ticker's next reading closes it, whatever it is (no
 * signal, the other side, or the same side at another strength: weak -> strong closes the weak position and opens a
 * strong one, and back). Entry and exit at the price known when the signal fired = the last close the ticker's market had
 * printed by then (a signal on Sunday trades at Friday's close). An open position is marked to the latest close.
 *
 * P&L: each day the book is split in equal slots, one per open position; a strong position invests its whole slot, a
 * weak one `weakWeight` of it (0-1, the page's cursor, default 0.5), the rest of its slot stays in cash; the book
 * compounds. The weight is absolute, never relative to the other positions (Kevin 2026-11-09: a lone weak position took
 * the whole book at 0.05 and nothing at 0).
 */

export type SignalReading = { id: string; signal: "BUY" | "SELL" | "none"; strength: "strong" | "weak" | "noise"; at: Date };

export type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  strength: "strong" | "weak";
  openedAt: Date;
  closedAt: Date | null;
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  markDate: string | null;
  markPrice: number | null;
  return: number | null;
};

export const DEFAULT_WEAK_WEIGHT = 0.5;

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

/** One ticker's positions from its signal readings (any order) and daily closes (date order). */
export function positionsFromReadings(symbol: string, readings: SignalReading[], bars: Bar[], market: string): Position[] {
  const ordered = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = bars.at(-1) ?? null;
  const out: Position[] = [];
  ordered.forEach((r, i) => {
    if (r.signal === "none") return;
    const side = r.signal === "BUY" ? "long" : "short";
    const next = ordered[i + 1] ?? null;
    const entry = closeKnownAt(bars, r.at, market);
    const exit = next ? closeKnownAt(bars, next.at, market) : null;
    const mark = next ? exit : last;
    out.push({
      id: r.id,
      symbol,
      side,
      strength: r.strength === "strong" ? "strong" : "weak",
      openedAt: r.at,
      closedAt: next?.at ?? null,
      entryDate: entry?.date ?? null,
      entryPrice: entry?.close ?? null,
      exitDate: exit?.date ?? null,
      exitPrice: exit?.close ?? null,
      markDate: entry ? (mark?.date ?? null) : null,
      markPrice: entry ? (mark?.close ?? null) : null,
      return: entry && mark ? positionReturn(entry.close, mark.close, side) : null,
    });
  });
  return out;
}

export type PnlPosition = Pick<Position, "symbol" | "side" | "strength" | "entryDate" | "exitDate" | "closedAt">;

export type Pnl = { lines: Line[]; totalReturn: number; benchmarkReturn: number | null };

/**
 * The book's curve since `start` (the first signal, ISO time) for one weak weight, and the S&P 500 rebased at the close
 * known at that moment, the same rule as an entry (else both lines would not start on the same day).
 */
export function portfolioPnl(positions: PnlPosition[], bars: Record<string, Bar[]>, benchmark: Bar[], start: string | null, weakWeight: number): Pnl {
  const priced = positions.filter((p) => p.entryDate !== null);
  const first = [start?.slice(0, 10) ?? null, ...priced.map((p) => p.entryDate!)].filter((d): d is string => d !== null).sort()[0];
  const days = first
    ? [...new Set([...priced.flatMap((p) => (bars[p.symbol] ?? []).map((x) => x.date)), ...benchmark.map((x) => x.date)])].filter((d) => d >= first).sort()
    : [];
  const closeAt = (symbol: string, d: string) => {
    let c: number | null = null;
    for (const x of bars[symbol] ?? []) {
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
      let slots = 0;
      for (const p of priced) {
        // Held over (prev, d]: entered at or before prev, not exited at or before prev. A closed position with no exit
        // close stored yet is held to the latest close.
        if (p.entryDate! > prev) continue;
        const exit = p.closedAt !== null ? p.exitDate : null;
        if (exit !== null && exit <= prev) continue;
        const u = p.strength === "strong" ? 1 : weakWeight;
        const a = closeAt(p.symbol, prev);
        const z = closeAt(p.symbol, exit !== null && exit < d ? exit : d);
        if (a === null || z === null) continue;
        sum += u * positionReturn(a, z, p.side)!;
        slots += 1;
      }
      if (slots > 0) equity *= 1 + sum / slots;
    }
    return { date: d, value: equity - 1 };
  });
  const lines: Line[] = [];
  if (points.length) lines.push({ name: "Signal book", kind: "portfolio", points });
  const base = start ? (closeKnownAt(benchmark, new Date(start), "US") ?? benchmark.find((x) => x.date >= start.slice(0, 10)) ?? null) : null;
  if (base) lines.push({ name: "S&P 500", kind: "benchmark", points: benchmark.filter((x) => x.date >= base.date).map((x) => ({ date: x.date, value: x.close / base.close - 1 })) });
  const bench = lines.find((l) => l.kind === "benchmark");
  return { lines, totalReturn: equity - 1, benchmarkReturn: bench ? bench.points.at(-1)!.value : null };
}

/** "Weak inflection" / "Strong crack": a BUY is a bad story inflecting, a SELL a loved one cracking. */
export function signalLabel(signal: string | null, strength: string | null): string {
  if (!signal || signal === "none") return "No signal";
  return `${strength === "strong" ? "Strong" : "Weak"} ${signal === "BUY" ? "inflection" : "crack"}`;
}
