import type { PriceObservation } from "@/db/schema/silver";

/** Two closes within 0.5% of each other are the same price (rounding, adjusted vs raw feeds). */
export const PRICE_TOLERANCE = 0.005;

/** Order of trust between price sources: the listing exchange's own feed first. */
export const PRICE_PRIORITY = ["nasdaq", "naver", "cnbc", "yahoo"] as const;

const rank = (s: string) => {
  const i = (PRICE_PRIORITY as readonly string[]).indexOf(s);
  return i === -1 ? PRICE_PRIORITY.length : i;
};

export type Consensus = {
  /** The source whose bar is shown (highest-priority member of the agreeing group). */
  lead: string;
  /** Every source whose close agrees with the shown close. */
  sources: string[];
  /** Sources whose close disagrees, with their close. */
  alternatives: { source: string; close: number }[];
};

/**
 * Groups the sources of one day by agreeing close and picks the group most sources agree on,
 * then the group holding the most trusted source. Pure and deterministic.
 */
export function priceConsensus(observations: Record<string, PriceObservation>): Consensus {
  const names = Object.keys(observations).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (names.length === 0) throw new Error("priceConsensus: no observation");
  const groups: string[][] = [];
  for (const name of names) {
    const close = observations[name].close;
    const group = groups.find((g) => Math.abs(observations[g[0]].close - close) <= PRICE_TOLERANCE * Math.abs(observations[g[0]].close));
    if (group) group.push(name);
    else groups.push([name]);
  }
  const winner = [...groups].sort((a, b) => b.length - a.length || rank(a[0]) - rank(b[0]))[0];
  return {
    lead: winner[0],
    sources: winner,
    alternatives: names.filter((n) => !winner.includes(n)).map((source) => ({ source, close: observations[source].close })),
  };
}
