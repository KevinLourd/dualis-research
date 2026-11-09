import type { GoldMarketReaction } from "@/db/schema/analysis";

/** Pure computations of the Market Reaction (the console bundle may import them). */

export type Bar = { date: string; close: number };
export type FvPoint = { day: string; value: number; low: number | null; high: number | null };

/** Last bar strictly before `day`; first bar on or after it; the bar `n` bars after that one. */
function around(bars: Bar[], day: string) {
  let next = bars.findIndex((b) => b.date >= day);
  if (next === -1) next = bars.length;
  return { before: next > 0 ? bars[next - 1] : null, next: next < bars.length ? bars[next] : null, at: (k: number) => (next + k < bars.length ? bars[next + k] : null) };
}

/** Last bar on or before `day`. */
function onOrBefore(bars: Bar[], day: string): Bar | null {
  let out: Bar | null = null;
  for (const b of bars) {
    if (b.date > day) break;
    out = b;
  }
  return out;
}

/** The fair value as it stood on `day`: the last one set on or before it, else the first one ever (its day says so). */
export function fairValueAt(history: FvPoint[], day: string): FvPoint | null {
  if (history.length === 0) return null;
  let out: FvPoint | null = null;
  for (const h of history) {
    if (h.day > day) break;
    out = h;
  }
  return out ?? history[0];
}

const ret = (to: number | null | undefined, from: number | null | undefined) => (to != null && from != null && from > 0 ? to / from - 1 : null);

/**
 * One item's reaction, all from stored closes (sorted oldest first, in the fair value's unit): close before the event,
 * next close, 5 closes later, today; the same span on the benchmark; the fair value then and now.
 */
export function reactionOf(
  item: { id: string; symbol: string; day: string },
  bars: Bar[],
  bench: Bar[],
  history: FvPoint[],
  now: FvPoint | null,
  currency: string | null,
): Omit<GoldMarketReaction, "rebuiltAt"> {
  const a = around(bars, item.day);
  const c5 = a.at(4);
  const last = bars.length ? bars[bars.length - 1] : null;
  const benchAt = (d: string | undefined) => (d ? onOrBefore(bench, d)?.close ?? null : null);
  const bBefore = benchAt(a.before?.date);
  const fv = fairValueAt(history, item.day);
  return {
    id: item.id,
    symbol: item.symbol,
    eventDay: item.day,
    currency,
    beforeDay: a.before?.date ?? null,
    closeBefore: a.before?.close ?? null,
    closeNext: a.next?.close ?? null,
    close5d: c5?.close ?? null,
    nowDay: last?.date ?? null,
    closeNow: last?.close ?? null,
    returnNext: ret(a.next?.close, a.before?.close),
    return5d: ret(c5?.close, a.before?.close),
    returnNow: ret(last?.close, a.before?.close),
    benchNext: ret(benchAt(a.next?.date), bBefore),
    bench5d: ret(benchAt(c5?.date), bBefore),
    benchNow: ret(benchAt(last?.date), bBefore),
    fvDay: fv?.day ?? null,
    fvThen: fv?.value ?? null,
    fvLowThen: fv?.low ?? null,
    fvHighThen: fv?.high ?? null,
    fvNow: now?.value ?? null,
    fvLowNow: now?.low ?? null,
    fvHighNow: now?.high ?? null,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const px = (x: number | null) => (x === null ? "n/a" : x >= 100 ? x.toFixed(0) : x.toFixed(2));
const range = (v: number | null, lo: number | null, hi: number | null) => `${px(v)}${lo !== null && hi !== null ? ` (range ${px(lo)} to ${px(hi)})` : ""}`;

/** One line for a judge: what the price did since the item, and where it stood vs the fair value then and now. */
export function reactionLine(r: Omit<GoldMarketReaction, "rebuiltAt"> | null | undefined): string {
  if (!r || r.closeBefore === null) return "Price: no close collected around this date.";
  const fvThen = r.fvThen === null ? "fair value then: none computed" : `fair value then ${range(r.fvThen, r.fvLowThen, r.fvHighThen)}${r.fvDay && r.fvDay > r.eventDay ? ` (first computed ${r.fvDay})` : ""}`;
  const fvNow = r.fvNow === null ? "" : `, fair value today ${range(r.fvNow, r.fvLowNow, r.fvHighNow)}`;
  return [
    `Price: ${px(r.closeBefore)} the close before`,
    `${px(r.closeNext)} next close (${pct(r.returnNext)}, S&P 500 ${pct(r.benchNext)})`,
    r.close5d !== null ? `${px(r.close5d)} five closes later (${pct(r.return5d)}, S&P 500 ${pct(r.bench5d)})` : null,
    `${px(r.closeNow)} today (${pct(r.returnNow)} since, S&P 500 ${pct(r.benchNow)}); ${fvThen}${fvNow}.`,
  ]
    .filter(Boolean)
    .join(", ");
}
