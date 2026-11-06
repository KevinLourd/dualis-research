import { positionReturn } from "@/content/signal-words";

/** Pure: the Portfolio chart's lines from the positions and their daily closes (tests share it). */

export type Bar = { date: string; close: number };
export type DrawablePosition = { symbol: string; direction: "long" | "short"; entryDate: string; entryPrice: number; weight: number | null };
export type Line = { name: string; kind: "position" | "portfolio" | "benchmark"; points: { date: string; value: number }[] };

/**
 * One line per position (its return since its own entry, sign flipped on a short), the S&P 500 over the same dates
 * (rebased at the first entry), and one weighted portfolio line ONLY when every position has a weight.
 */
export function returnLines(positions: DrawablePosition[], bars: Map<string, Bar[]>, benchmark: Bar[], allWeighted: boolean): Line[] {
  if (positions.length === 0) return [];
  const start = positions.map((p) => p.entryDate).sort()[0];
  const lines: Line[] = positions.map((p) => ({
    name: p.symbol,
    kind: "position",
    points: (bars.get(p.symbol) ?? [])
      .filter((b) => b.date >= p.entryDate)
      .map((b) => ({ date: b.date, value: positionReturn(p.entryPrice, b.close, p.direction)! })),
  }));

  if (allWeighted) {
    const byDay = new Map<string, Map<string, number>>();
    for (const l of lines) for (const pt of l.points) byDay.set(pt.date, (byDay.get(pt.date) ?? new Map()).set(l.name, pt.value));
    const days = [...byDay.keys()].sort();
    const last = new Map<string, number>();
    const points = days.map((d) => {
      for (const [s, v] of byDay.get(d)!) last.set(s, v);
      let sum = 0;
      let w = 0;
      for (const p of positions) {
        const v = last.get(p.symbol);
        if (v === undefined || p.entryDate > d) continue;
        sum += (p.weight ?? 0) * v;
        w += p.weight ?? 0;
      }
      return { date: d, value: w > 0 ? sum / w : 0 };
    });
    lines.unshift({ name: "Portfolio", kind: "portfolio", points });
  }

  const base = benchmark.find((b) => b.date >= start);
  if (base) lines.push({ name: "S&P 500", kind: "benchmark", points: benchmark.filter((b) => b.date >= base.date).map((b) => ({ date: b.date, value: b.close / base.close - 1 })) });
  return lines;
}
