import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { exhibits, narrativeDrivers, narratives, narrativeStates, signals, type ThesisSide } from "@/db/schema/analysis";
import type * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import { tagWord } from "@/content/signal-words";
import type { Complete } from "@/llm/complete";
import { judge } from "@/llm/judge";
import { formatUnit, periodLabel, seriesPeriod } from "../../../console/exhibit-format";
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
  /** `base` = the earlier period the reality line compares the latest value to (null: no comparison). */
  drivers: { title: string; tag: string; headline: string | null; exhibit: VisualExhibit; base: string | null }[];
};

export const MAX_PANELS = 3;

export const NO_COMPARISON = "none";

/**
 * Which earlier period the reality line compares the chart's latest value to (« Q3 sales up 6% vs Q2 » -> Q2), judged
 * ONCE per driver x chart x line and stored (silver.judgments), so the picture boxes both periods and draws the arrow
 * between them (Kevin 2026-11-12: « tu compares 2 quarters, donc encadre les deux »).
 */
export async function comparedPeriod(db: Db, complete: Complete, driverId: string, reality: string, e: VisualExhibit): Promise<string | null> {
  const lead = e.series[0];
  const pts = e.points.filter((p) => typeof p.values[lead.key] === "number");
  if (pts.length < 2) return null;
  const earlier = pts.slice(0, -1).map((p) => p.period);
  const fmt = (p: (typeof pts)[number]) => `${p.period} (${periodLabel(p.period, seriesPeriod(lead.key))}): ${formatUnit(p.values[lead.key] as number, lead.unit, lead.currency)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reality));
  const hash = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const j = await judge(
    db,
    {
      subjectKind: "driver-state",
      subjectId: driverId,
      questionKey: `reality-base@v1:${e.id}:${hash}`,
      question: `This line describes the latest value of the chart « ${e.title} » (${fmt(pts.at(-1)!)}). Which EARLIER period of the chart does it compare that latest value to? Answer the period id, or "${NO_COMPARISON}" when it compares to nothing on the chart.`,
      input: [`Line: ${reality}`, "Chart values:", ...pts.map(fmt)].join("\n"),
      choices: [...earlier, NO_COMPARISON],
    },
    complete,
  );
  return j.verdict === NO_COMPARISON || !earlier.includes(j.verdict) ? null : j.verdict;
}

export async function opportunityStory(db: Db, symbol: string, complete?: Complete): Promise<OpportunityStory | null> {
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
    const exhibit: VisualExhibit = { id: e.id, driverTitle: d.title, side, title: e.title, chart: e.chart, series: e.series, points: e.points, takeaway: e.takeaway, sources: e.sources };
    const base = complete && s.headline && s.driverId ? await comparedPeriod(db, complete, s.driverId, s.headline, exhibit) : null;
    out.push({ title: d.title, tag: tagWord("reversal", s.strength, side).toUpperCase(), headline: s.headline, exhibit, base });
    if (out.length === MAX_PANELS) break;
  }
  return out.length ? { input, side, narrative: story.text, drivers: out } : null;
}
