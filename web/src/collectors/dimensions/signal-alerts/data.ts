import { and, asc, eq, gte } from "drizzle-orm";
import { fairValues, narrativeDrivers, narrativeStates, signals, type ThesisSide } from "@/db/schema/analysis";
import { companyProfiles, priceBars } from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { sideOfSignal, type SignalStep } from "@/content/signal-alert";

/**
 * What the alert image shows, read from gold when the alert is planned (it lands in bronze as the plan's payload):
 * the level B panel in one picture (Kevin 2026-11-09): the signal, fair value and quote, the price vs fair value
 * chart, and the Narrative Drivers with their Status.
 */
export type AlertInput = SignalStep & {
  symbol: string;
  name: string | null;
  side: ThesisSide;
  quote: number | null;
  quoteDate: string | null;
  currency: string | null;
  fair: { value: number; low: number | null; high: number | null } | null;
  /** Closes of the last 12 months, oldest first. */
  bars: { date: string; close: number }[];
  priceSources: string[];
  drivers: {
    category: string;
    title: string;
    summary: string | null;
    state: { effect: string; strength: string; headline: string | null; since: string | null; pricedIn: string | null } | null;
  }[];
};

const PRICE_SOURCE_LABEL: Record<string, string> = { yahoo: "Yahoo Finance", nasdaq: "Nasdaq", cnbc: "CNBC", naver: "Naver Finance" };

export async function alertInput(db: Db, c: SignalStep & { symbol: string }, now = new Date()): Promise<AlertInput> {
  const side = sideOfSignal(c.toSignal);
  const since = new Date(now.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const [[profile], [sig], [fair], bars, drivers, states] = await Promise.all([
    db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, c.symbol)),
    db.select({ quote: signals.quote, quoteDate: signals.quoteDate, currency: signals.currency }).from(signals).where(eq(signals.symbol, c.symbol)),
    db.select().from(fairValues).where(eq(fairValues.symbol, c.symbol)),
    db.select({ date: priceBars.date, close: priceBars.close, sources: priceBars.sources }).from(priceBars).where(and(eq(priceBars.symbol, c.symbol), gte(priceBars.date, since))).orderBy(asc(priceBars.date)),
    db.select().from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, c.symbol), eq(narrativeDrivers.side, side))).orderBy(asc(narrativeDrivers.rank)),
    db.select().from(narrativeStates).where(and(eq(narrativeStates.symbol, c.symbol), eq(narrativeStates.side, side), eq(narrativeStates.level, "driver"))),
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
    quote: sig?.quote ?? null,
    quoteDate: sig?.quoteDate ?? null,
    currency: fair?.currency ?? sig?.currency ?? null,
    fair: fair ? { value: fair.value, low: fair.low, high: fair.high } : null,
    bars: bars.map((b) => ({ date: b.date, close: b.close })),
    priceSources: [...new Set(bars.flatMap((b) => b.sources))].map((s) => PRICE_SOURCE_LABEL[s] ?? s),
    drivers: [...rows].sort((a, b) => turn(b).localeCompare(turn(a))),
  };
}
