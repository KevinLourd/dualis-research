import type { LineObservation } from "@/db/schema/financials";

/** Two published values within 0.5% are the same figure (rounding to thousands, a restated decimal). */
export const LINE_TOLERANCE = 0.005;

export type LineConsensus = { lead: string; sources: string[]; alternatives: { source: string; value: number }[] };

/**
 * Groups one line's observations by agreeing value and keeps the group most sources agree on, then the one holding
 * the most trusted source. Pure and deterministic (same rule as price closes).
 */
export function lineConsensus(observations: Record<string, LineObservation>, priority: readonly string[]): LineConsensus {
  const rank = (s: string) => (priority.indexOf(s) === -1 ? priority.length : priority.indexOf(s));
  const names = Object.keys(observations).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (names.length === 0) throw new Error("lineConsensus: no observation");
  const groups: string[][] = [];
  for (const name of names) {
    const v = observations[name].value;
    const group = groups.find((g) => {
      const ref = observations[g[0]].value;
      return ref === v || Math.abs(ref - v) <= LINE_TOLERANCE * Math.max(Math.abs(ref), Math.abs(v));
    });
    if (group) group.push(name);
    else groups.push([name]);
  }
  const winner = [...groups].sort((a, b) => b.length - a.length || rank(a[0]) - rank(b[0]))[0];
  return {
    lead: winner[0],
    sources: winner,
    alternatives: names.filter((n) => !winner.includes(n)).map((source) => ({ source, value: observations[source].value })),
  };
}
