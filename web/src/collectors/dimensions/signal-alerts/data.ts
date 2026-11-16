import { and, asc, eq } from "drizzle-orm";
import { type ExhibitPoint, type ExhibitSeries, narrativeDrivers, narratives, narrativeStates, type ThesisSide } from "@/db/schema/analysis";
import { companyProfiles } from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { sideOfSignal, type SignalStep } from "@/content/signal-alert";
import type { Complete } from "@/llm/complete";
import { storyBreak } from "../content-visuals/story-break";

/**
 * What the alert shows, read from gold when the alert is planned (it lands in bronze as the plan's payload): the signal,
 * the story the market holds, the reported figure that breaks it (the strongest driver reversing now, with its chart and
 * the two periods it compares), and the Narrative Drivers with their Status. Never the fair value, the quote vs it or a
 * gap (Thierry 2026-11-16: not confident in our fair values; real figures + the shortest convincing why of the break).
 */
export type AlertInput = SignalStep & {
  symbol: string;
  name: string | null;
  side: ThesisSide;
  /** The story the market holds on the signal's thesis (one sentence). */
  narrative: string | null;
  /** The reported figure that breaks the story: the judge's reality line + the Exhibit it reads, latest vs `base`. */
  breaks: {
    driver: string;
    tag: string;
    headline: string | null;
    chart: { title: string; chart: "bar" | "line"; series: ExhibitSeries[]; points: ExhibitPoint[]; sources: string[] };
    base: string | null;
  }[];
  drivers: {
    category: string;
    title: string;
    summary: string | null;
    state: { effect: string; strength: string; headline: string | null; since: string | null; pricedIn: string | null } | null;
  }[];
};

/** Panels of the alert: the strongest reversing driver's figure first (one picture stays short on a phone). */
export const ALERT_BREAKS = 1;

export async function alertInput(db: Db, c: SignalStep & { symbol: string }, complete?: Complete): Promise<AlertInput> {
  const side = sideOfSignal(c.toSignal);
  const [[profile], [story], drivers, states, broken] = await Promise.all([
    db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, c.symbol)),
    db.select({ text: narratives.text }).from(narratives).where(eq(narratives.id, `${c.symbol}:${side}`)),
    db.select().from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, c.symbol), eq(narrativeDrivers.side, side))).orderBy(asc(narrativeDrivers.rank)),
    db.select().from(narrativeStates).where(and(eq(narrativeStates.symbol, c.symbol), eq(narrativeStates.side, side), eq(narrativeStates.level, "driver"))),
    storyBreak(db, c.symbol, complete, side),
  ]);
  const rows = drivers.map((d) => {
    const s = states.find((x) => x.driverId === d.id);
    return { category: d.category, title: d.title, summary: d.summary, state: s ? { effect: s.effect, strength: s.strength, headline: s.headline, since: s.since, pricedIn: s.pricedIn } : null };
  });
  // Same order as the console's Status table: the newest turn first, noise and unjudged last (by rank).
  const turn = (r: (typeof rows)[number]) => (r.state && r.state.effect !== "noise" ? r.state.since : null) ?? "";
  return {
    symbol: c.symbol,
    fromSignal: c.fromSignal,
    fromStrength: c.fromStrength,
    toSignal: c.toSignal,
    toStrength: c.toStrength,
    name: profile?.name ?? null,
    side,
    narrative: story?.text ?? null,
    breaks: (broken?.drivers ?? []).slice(0, ALERT_BREAKS).map((d) => ({
      driver: d.title,
      tag: d.tag,
      headline: d.headline,
      chart: { title: d.exhibit.title, chart: d.exhibit.chart, series: d.exhibit.series, points: d.exhibit.points, sources: d.exhibit.sources },
      base: d.base,
    })),
    drivers: [...rows].sort((a, b) => turn(b).localeCompare(turn(a))),
  };
}
