import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { exhibits, narrativeDrivers, narratives, narrativeStates, signals, type ThesisSide } from "@/db/schema/analysis";
import type * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import { tagWord } from "@/content/signal-words";
import { visualInput, type VisualExhibit, type VisualInput } from "./data";

/**
 * The opportunity story of a ticker (Kevin 2026-11-12, the frame of every Sandbox picture, all 6 accounts): the narrative
 * that explains why the price sits below (or above) its fair value, and the 1-3 drivers of that narrative that are
 * reversing NOW (weak or strong), each with its chart. Read from gold only; null when there is nothing to show (no
 * narrative, no fair value, or no driver reversing: then there is no opportunity to draw).
 */
export type OpportunityStory = {
  input: VisualInput;
  side: ThesisSide;
  narrative: string;
  drivers: { title: string; tag: string; headline: string | null; exhibit: VisualExhibit }[];
};

export const MAX_PANELS = 3;

export async function opportunityStory(db: Db, symbol: string): Promise<OpportunityStory | null> {
  const idea = { id: crypto.randomUUID(), symbol, title: symbol, angle: "", sourceRefs: [] } as unknown as content.SilverContentIdea;
  const input = await visualInput(db, idea);
  const last = input.bars.at(-1);
  if (!input.fair || !last) return null;
  const [sig] = await db.select({ side: signals.side }).from(signals).where(eq(signals.symbol, symbol));
  // The signalling thesis, else the one the price's side of fair value tells (below = the pessimistic story, long).
  const side: ThesisSide = sig?.side ?? (last.close < input.fair.value ? "long" : "short");
  const [story] = await db.select({ text: narratives.text }).from(narratives).where(eq(narratives.id, `${symbol}:${side}`));
  if (!story) return null;
  const states = await db
    .select({ driverId: narrativeStates.driverId, strength: narrativeStates.strength, headline: narrativeStates.headline })
    .from(narrativeStates)
    .where(and(eq(narrativeStates.symbol, symbol), eq(narrativeStates.side, side), eq(narrativeStates.level, "driver"), eq(narrativeStates.effect, "reversal"), inArray(narrativeStates.strength, ["strong", "weak"])))
    .orderBy(asc(narrativeStates.strength), desc(narrativeStates.asOf));
  const ids = states.flatMap((s) => (s.driverId ? [s.driverId] : []));
  if (ids.length === 0) return null;
  const [drivers, charts] = await Promise.all([
    db.select({ id: narrativeDrivers.id, title: narrativeDrivers.title }).from(narrativeDrivers).where(inArray(narrativeDrivers.id, ids)),
    db.select().from(exhibits).where(inArray(exhibits.driverId, ids)).orderBy(asc(exhibits.rank)),
  ]);
  const out: OpportunityStory["drivers"] = [];
  for (const s of states) {
    const d = drivers.find((x) => x.id === s.driverId);
    // Its first chart that carries numbers (a driver with no chart cannot be shown).
    const e = charts.find((c) => c.driverId === s.driverId && c.points.some((p) => typeof p.values[c.series[0]?.key] === "number"));
    if (!d || !e) continue;
    out.push({
      title: d.title,
      tag: tagWord("reversal", s.strength, side).toUpperCase(),
      headline: s.headline,
      exhibit: { id: e.id, driverTitle: d.title, side, title: e.title, chart: e.chart, series: e.series, points: e.points, takeaway: e.takeaway, sources: e.sources },
    });
    if (out.length === MAX_PANELS) break;
  }
  return out.length ? { input, side, narrative: story.text, drivers: out } : null;
}
