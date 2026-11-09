import { eq } from "drizzle-orm";
import { quoteStamp } from "../intraday-price";
import { fairValues, THESIS_SIDES, type ThesisSide } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { majorUnit } from "../financials/derive";

/**
 * Which theses a ticker gets (Kevin 2026-11-09): price below the fair value range = the long thesis only (the market
 * holds a pessimistic story); above it = the short thesis only; inside it = BOTH, judged in competition. A fair value
 * without a range (Thierry's own number) is a range of one point.
 */
export function sidesFor(price: number, fv: { value: number; low: number | null; high: number | null }): ThesisSide[] {
  const low = fv.low ?? fv.value;
  const high = fv.high ?? fv.value;
  if (price < low) return ["long"];
  if (price > high) return ["short"];
  return [...THESIS_SIDES];
}

export const thesisId = (symbol: string, side: ThesisSide) => `${symbol}:${side}`;
export function parseThesisId(id: string): { symbol: string; side: ThesisSide } {
  const i = id.lastIndexOf(":");
  const side = id.slice(i + 1);
  if (side !== "long" && side !== "short") throw new Error(`"${id}" is not a thesis id <symbol>:<long|short>`);
  return { symbol: id.slice(0, i), side };
}
export const driverIdOf = (symbol: string, side: ThesisSide, rank: number) => `${symbol}:${side}:${rank}`;

/** The fair value (base, low, high) and the quote in the same unit, or null when either is missing or currencies differ. */
export async function priceAndFairValue(db: Db, symbol: string): Promise<{ price: number; date: string; stamp: string; currency: string | null; fv: { value: number; low: number | null; high: number | null; currency: string | null } } | null> {
  const [[fv], [q]] = await Promise.all([db.select().from(fairValues).where(eq(fairValues.symbol, symbol)), db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol))]);
  if (!fv || !q || !(fv.value > 0)) return null;
  const m = majorUnit(q.close, q.currency);
  if (fv.currency && m.currency && fv.currency !== m.currency) return null;
  return { price: m.price, date: q.date, stamp: quoteStamp(q), currency: m.currency ?? fv.currency, fv: { value: fv.value, low: fv.low, high: fv.high, currency: fv.currency } };
}

/** The ticker's current theses (none without a fair value and a comparable quote). */
export async function currentSides(db: Db, symbol: string): Promise<ThesisSide[]> {
  const p = await priceAndFairValue(db, symbol);
  return p ? sidesFor(p.price, p.fv) : [];
}

/** How each thesis reads in the prompts and on screen: its story and what its turn is. */
export const SIDE = {
  long: {
    label: "Long thesis",
    story: "the PESSIMISTIC story the market holds, the reason the price sits at or below fair value",
    reversal: "the bad reason turns: things get better than the market believes (an inflection, the setup of a BUY)",
    continuation: "the bad reason gets worse: the pessimistic story gets stronger",
    signal: "BUY",
    turn: "inflection",
  },
  short: {
    label: "Short thesis",
    story: "the OPTIMISTIC story the market holds, the reason the price sits at or above fair value",
    reversal: "the good reason breaks: things get worse than the market believes (a crack, the setup of a SELL)",
    continuation: "the good reason gets better: the optimistic story gets stronger",
    signal: "SELL",
    turn: "crack",
  },
} as const satisfies Record<ThesisSide, { label: string; story: string; reversal: string; continuation: string; signal: "BUY" | "SELL"; turn: string }>;

/**
 * The thesis content speaks for: the one that signals, else the only one; null when two compete and neither surfaces
 * (Ideas and drafts then say the ticker has no signal, never a story of one side).
 */
export function publicSide(signal: { side: ThesisSide | null } | null | undefined, theses: { side: ThesisSide }[]): ThesisSide | null {
  if (signal?.side) return signal.side;
  return theses.length === 1 ? theses[0].side : null;
}
