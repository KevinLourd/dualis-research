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
 * The story break of a ticker (Kevin 2026-11-12, the frame of every Sandbox picture, all 6 accounts; Thierry 2026-11-16:
 * real reported figures, never our fair value): the narrative the market holds and the 1-3 drivers of that narrative
 * reversing NOW (weak or strong), each with the chart of its reported figure. Read from gold only; null when there is
 * nothing to show (no narrative, or no driver reversing). The fair value is never read here.
 */
export type StoryBreak = {
  input: VisualInput;
  side: ThesisSide;
  narrative: string;
  /** The ticker's live signal in words (« BUY, strong inflection »), null when none. */
  signal: { signal: "BUY" | "SELL"; strength: string } | null;
  /** `base` = the earlier period the reality line compares the latest value to (null: no comparison). */
  drivers: { title: string; tag: string; headline: string | null; exhibit: VisualExhibit; base: string | null }[];
};

export const MAX_PANELS = 3;

/** Caption prefix of a story-break picture (sandbox-image-fix reads it: that picture is drawn from the analysis). */
export const STORY_CAPTION = "Story break:";

/**
 * The line under the company, per tone: the signal's words, never a price or a fair value (Thierry 2026-11-16). With no
 * live signal on that thesis, the strongest reversing driver's tag stands in.
 */
export function storyHeadline(story: Pick<StoryBreak, "signal" | "drivers">, tone: "urgent" | "balanced" | "neutral"): string {
  const tag = story.signal ? tagWord("reversal", story.signal.strength, story.signal.signal === "BUY" ? "long" : "short") : (story.drivers[0]?.tag ?? "");
  const word = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
  const n = story.drivers.length;
  const figures = `${n} reported figure${n > 1 ? "s" : ""} against the story`;
  if (tone === "urgent") return `${word.toUpperCase()}${story.signal ? `: ${story.signal.signal}` : ""}`;
  if (tone === "neutral") return `${story.signal ? `${story.signal.signal}, ${word.toLowerCase()}` : word}. ${figures}.`;
  return `${story.signal ? `${story.signal.signal} · ` : ""}${word} · ${figures}`;
}

/** The line above the panels, per tone: what the market believes, then the reported figures. */
export function storyIntro(up: boolean, tone: "urgent" | "balanced" | "neutral"): string {
  if (tone === "urgent") return up ? "The market is still pricing the old story. The numbers say otherwise:" : "The market is still pricing the dream. The numbers say otherwise:";
  if (tone === "neutral") return "The story behind the price, and the latest reported data:";
  return up ? "What the market believes, and the reported figures turning it:" : "What the market believes, and the reported figures breaking it:";
}

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

/** `side` = the thesis to read (a signal alert names it); else the signalling thesis, else the one whose drivers reverse. */
export async function storyBreak(db: Db, symbol: string, complete?: Complete, only?: ThesisSide): Promise<StoryBreak | null> {
  const idea = { id: crypto.randomUUID(), symbol, title: symbol, angle: "", sourceRefs: [] } as unknown as content.SilverContentIdea;
  const [input, [sig], reversing] = await Promise.all([
    visualInput(db, idea),
    db.select({ side: signals.side, signal: signals.signal, strength: signals.strength }).from(signals).where(eq(signals.symbol, symbol)),
    db
      .select({ driverId: narrativeStates.driverId, side: narrativeStates.side, strength: narrativeStates.strength, headline: narrativeStates.headline })
      .from(narrativeStates)
      .where(and(eq(narrativeStates.symbol, symbol), eq(narrativeStates.level, "driver"), eq(narrativeStates.effect, "reversal"), inArray(narrativeStates.strength, ["strong", "weak"])))
      .orderBy(asc(narrativeStates.strength), desc(narrativeStates.asOf)),
  ]);
  const side: ThesisSide | undefined = only ?? (sig?.signal !== "none" ? (sig?.side ?? undefined) : undefined) ?? reversing[0]?.side;
  if (!side) return null;
  const [story] = await db.select({ text: narratives.text }).from(narratives).where(eq(narratives.id, `${symbol}:${side}`));
  if (!story) return null;
  const states = reversing.filter((s) => s.side === side);
  const ids = states.flatMap((s) => (s.driverId ? [s.driverId] : []));
  if (ids.length === 0) return null;
  const [drivers, charts] = await Promise.all([
    db.select({ id: narrativeDrivers.id, title: narrativeDrivers.title }).from(narrativeDrivers).where(inArray(narrativeDrivers.id, ids)),
    db.select().from(exhibits).where(inArray(exhibits.driverId, ids)).orderBy(asc(exhibits.rank)),
  ]);
  const out: StoryBreak["drivers"] = [];
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
  const signal = sig && sig.signal !== "none" && sig.side === side ? { signal: sig.signal, strength: sig.strength } : null;
  return out.length ? { input, side, narrative: story.text, signal, drivers: out } : null;
}
