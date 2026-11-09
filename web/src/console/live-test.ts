import { positionReturn } from "@/content/signal-words";
import type { Bar, Line } from "./portfolio-series";

/**
 * Live test (Kevin 2026-11-09): what following the Signal would have returned. Pure, so the `signals` collector (which
 * stores the positions), the page and the tests share it. No trading costs, spread or slippage (owner: « on néglige tous
 * les coûts de transaction »).
 *
 * Positions: every BUY (long) or SELL (short) reading opens one; the ticker's next reading closes it, whatever it is (no
 * signal, the other side, or the same side at another strength: weak -> strong closes the weak position and opens a
 * strong one, and back). Entry and exit at the price known when the signal fired (Kevin 2026-11-09: « il te faut les
 * intraday prices »): the last 5-minute bar already closed, else the last daily close printed (a signal on Sunday trades
 * at Friday's close). An open position is marked to the latest price.
 *
 * P&L: each day the book is split in equal slots, one per open position; a strong position invests its whole slot, a
 * weak one `weakWeight` of it (0-1, the page's cursor, default 0.5), the rest of its slot stays in cash; the book
 * compounds. The weight is absolute, never relative to the other positions (Kevin 2026-11-09: a lone weak position took
 * the whole book at 0.05 and nothing at 0). The entry day runs from the entry price, the exit day to the exit price,
 * today to the latest price.
 */

export type SignalReading = { id: string; signal: "BUY" | "SELL" | "none"; strength: "strong" | "weak" | "noise"; at: Date };

/** A 5-minute bar: `at` = its start, its close is known INTRADAY_MS later; `date` = its trading day (exchange time). */
export type Tick = { at: Date; date: string; close: number };
export type PriceBasis = "intraday" | "close";
/** A price and when it was known. */
export type PricePoint = { price: number; date: string; at: Date; source: PriceBasis };

export const INTRADAY_MS = 5 * 60_000;

export type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  strength: "strong" | "weak";
  openedAt: Date;
  closedAt: Date | null;
  entryDate: string | null;
  entryPrice: number | null;
  entryAt: Date | null;
  entrySource: PriceBasis | null;
  exitDate: string | null;
  exitPrice: number | null;
  exitAt: Date | null;
  exitSource: PriceBasis | null;
  markDate: string | null;
  markPrice: number | null;
  markAt: Date | null;
  markSource: PriceBasis | null;
  return: number | null;
};

export const DEFAULT_WEAK_WEIGHT = 0.5;

/** When each market's daily close prints, in UTC (regular session end; November = standard time in Europe and the US). */
const CLOSE_UTC: Record<string, string> = { US: "21:00", CA: "21:00", JP: "06:30", KR: "06:30", HK: "08:00", AU: "05:00", UK: "16:30", EU: "16:30" };

const closeTime = (date: string, market: string) => {
  const hhmm = CLOSE_UTC[market];
  if (!hhmm) throw new Error(`live test: no close time for market ${market}`);
  return new Date(`${date}T${hhmm}:00Z`);
};

/** The last close of `market` already printed at `at`. */
export function closeKnownAt(bars: Bar[], at: Date, market: string): Bar | null {
  let known: Bar | null = null;
  for (const b of bars) {
    if (closeTime(b.date, market).getTime() > at.getTime()) break;
    known = b;
  }
  return known;
}

/**
 * The price a trade at `at` gets: the most recent of the last 5-minute bar already closed and the last daily close
 * already printed. `ticks` may be sparse (only the bars looked up for the moments that matter), in time order.
 */
export function priceKnownAt(bars: Bar[], ticks: Tick[], at: Date, market: string): PricePoint | null {
  let tick: Tick | null = null;
  for (const t of ticks) {
    if (t.at.getTime() + INTRADAY_MS > at.getTime()) break;
    tick = t;
  }
  const close = closeKnownAt(bars, at, market);
  const fromTick: PricePoint | null = tick ? { price: tick.close, date: tick.date, at: new Date(tick.at.getTime() + INTRADAY_MS), source: "intraday" } : null;
  const fromClose: PricePoint | null = close ? { price: close.close, date: close.date, at: closeTime(close.date, market), source: "close" } : null;
  if (!fromTick) return fromClose;
  if (!fromClose) return fromTick;
  return fromClose.at.getTime() >= fromTick.at.getTime() ? fromClose : fromTick;
}

/** The latest price: the last 5-minute bar (still moving during the session) or the last daily close, whichever is newer. */
export function latestPrice(bars: Bar[], ticks: Tick[], market: string): PricePoint | null {
  return priceKnownAt(bars, ticks, new Date(8.64e15), market);
}

/** One ticker's positions from its signal readings (any order), daily closes and 5-minute bars (both in time order). */
export function positionsFromReadings(symbol: string, readings: SignalReading[], bars: Bar[], market: string, ticks: Tick[] = []): Position[] {
  const ordered = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = latestPrice(bars, ticks, market);
  const out: Position[] = [];
  ordered.forEach((r, i) => {
    if (r.signal === "none") return;
    const side = r.signal === "BUY" ? "long" : "short";
    const next = ordered[i + 1] ?? null;
    const entry = priceKnownAt(bars, ticks, r.at, market);
    const exit = next ? priceKnownAt(bars, ticks, next.at, market) : null;
    const mark = entry ? (next ? exit : last) : null;
    out.push({
      id: r.id,
      symbol,
      side,
      strength: r.strength === "strong" ? "strong" : "weak",
      openedAt: r.at,
      closedAt: next?.at ?? null,
      entryDate: entry?.date ?? null,
      entryPrice: entry?.price ?? null,
      entryAt: entry?.at ?? null,
      entrySource: entry?.source ?? null,
      exitDate: exit?.date ?? null,
      exitPrice: exit?.price ?? null,
      exitAt: exit?.at ?? null,
      exitSource: exit?.source ?? null,
      markDate: mark?.date ?? null,
      markPrice: mark?.price ?? null,
      markAt: mark?.at ?? null,
      markSource: mark?.source ?? null,
      return: entry && mark ? positionReturn(entry.price, mark.price, side) : null,
    });
  });
  return out;
}

export type PnlPosition = Pick<Position, "symbol" | "side" | "strength" | "entryDate" | "entryPrice" | "exitDate" | "exitPrice" | "markDate" | "markPrice" | "closedAt">;

/** The S&P 500 leg: bought at `base` (the price known when the first signal fired), marked to `mark`. */
export type PnlBenchmark = { bars: Bar[]; base: Pick<PricePoint, "price" | "date" | "source"> | null; mark: Pick<PricePoint, "price" | "date"> | null };

export type Pnl = { lines: Line[]; totalReturn: number; benchmarkReturn: number | null };

/**
 * The book's curve for one weak weight, and the S&P 500 bought the same way. Day d's step runs from the previous day's
 * close (or the entry price, on the entry day) to day d's close (or the exit price on the exit day, the latest price on
 * the mark day). Both lines start at 0 on the trading day before the first price they hold.
 */
export function portfolioPnl(positions: PnlPosition[], bars: Record<string, Bar[]>, benchmark: PnlBenchmark, weakWeight: number): Pnl {
  const priced = positions.filter((p) => p.entryDate !== null && p.entryPrice !== null);
  const first = priced.map((p) => p.entryDate!).sort()[0];
  const lines: Line[] = [];
  let equity = 1;
  if (first) {
    const all = [
      ...new Set([
        ...priced.flatMap((p) => [...(bars[p.symbol] ?? []).map((x) => x.date), p.entryDate!, ...(p.exitDate ? [p.exitDate] : []), ...(p.markDate ? [p.markDate] : [])]),
        ...benchmark.bars.map((x) => x.date),
      ]),
    ].sort();
    const before = all.filter((d) => d < first).at(-1);
    const days = all.filter((d) => d >= first);
    if (before) days.unshift(before);
    const closeAt = (symbol: string, d: string) => {
      let c: number | null = null;
      for (const x of bars[symbol] ?? []) {
        if (x.date > d) break;
        c = x.close;
      }
      return c;
    };
    const points = days.map((d, i) => {
      if (i > 0) {
        const prev = days[i - 1];
        let sum = 0;
        let slots = 0;
        for (const p of priced) {
          // Held over (prev, d]: entered on or before d, not exited on or before prev. A closed position with no exit
          // price stored yet is held to the latest price, like an open one.
          if (p.entryDate! > d) continue;
          const exited = p.closedAt !== null && p.exitDate !== null && p.exitPrice !== null;
          if (exited && p.exitDate! <= prev) continue;
          const u = p.strength === "strong" ? 1 : weakWeight;
          const a = p.entryDate! > prev ? p.entryPrice! : closeAt(p.symbol, prev);
          const z = exited && p.exitDate! <= d ? p.exitPrice! : !exited && p.markDate === d && p.markPrice !== null ? p.markPrice : closeAt(p.symbol, d);
          if (a === null || z === null) continue;
          sum += u * positionReturn(a, z, p.side)!;
          slots += 1;
        }
        if (slots > 0) equity *= 1 + sum / slots;
      }
      return { date: d, value: equity - 1 };
    });
    if (points.length) lines.push({ name: "Signal book", kind: "portfolio", points });
  }
  const { base, mark } = benchmark;
  if (base) {
    // Bought at a close: the line starts that day. Bought during a session: it starts the day before, the session's
    // close is the first move.
    const start = base.source === "close" ? base.date : (benchmark.bars.filter((x) => x.date < base.date).at(-1)?.date ?? base.date);
    const byDate = new Map<string, number>([[start, 0]]);
    for (const x of benchmark.bars) if (x.date > start) byDate.set(x.date, x.close / base.price - 1);
    if (mark && mark.date >= start) byDate.set(mark.date, mark.price / base.price - 1);
    const points = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
    lines.push({ name: "S&P 500", kind: "benchmark", points });
  }
  const bench = lines.find((l) => l.kind === "benchmark");
  return { lines, totalReturn: equity - 1, benchmarkReturn: bench ? bench.points.at(-1)!.value : null };
}

/** "Weak inflection" / "Strong crack": a BUY is a bad story inflecting, a SELL a loved one cracking. */
export function signalLabel(signal: string | null, strength: string | null): string {
  if (!signal || signal === "none") return "No signal";
  return `${strength === "strong" ? "Strong" : "Weak"} ${signal === "BUY" ? "inflection" : "crack"}`;
}
