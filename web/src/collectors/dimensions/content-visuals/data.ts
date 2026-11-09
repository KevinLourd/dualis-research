import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { evidence, exhibits, type ExhibitPoint, type ExhibitSeries, fairValues, narrativeDrivers, narratives, type ThesisSide } from "@/db/schema/analysis";
import * as content from "@/db/schema/content";
import { companyProfiles, priceBars } from "@/db/schema/gold";
import type { Db } from "@/db/types";

/** What the visuals of one Idea are drawn from, read from gold when they are made. */
export type VisualInput = {
  symbol: string;
  companyName: string | null;
  /** The Idea in one sentence: the card's headline. */
  title: string;
  /** Closes of the last 12 months, oldest first. */
  bars: { date: string; close: number }[];
  priceSources: string[];
  fair: { value: number; currency: string | null; low: number | null; high: number | null } | null;
  /** The first news the Idea cites that has a link: what a capture shows. */
  newsUrl: string | null;
  /** The news items the Idea cites (headline + publisher): the chart's headline strip shows the most prestigious one. */
  news: { headline: string; publisher: string; url: string | null; at: Date }[];
  /** The drivers the Idea rests on, each with its thesis side, and the narrative of each side: what the price says. */
  drivers: { title: string; summary: string | null; side: ThesisSide }[];
  narratives: { side: ThesisSide; text: string }[];
  /** How the Idea is told: the chart judge reads it with the title. */
  angle: string;
  /** Exhibits of the Narrative Drivers the Idea cites (directly, or through the Evidence it cites), numbers from gold. */
  exhibits: VisualExhibit[];
};

/** One gold Exhibit the chart can draw instead of the price. */
export type VisualExhibit = {
  id: string;
  driverTitle: string;
  /** The thesis the driver belongs to: long (its turn = inflection) or short (its turn = crack). */
  side: ThesisSide;
  title: string;
  chart: "bar" | "line";
  series: ExhibitSeries[];
  points: ExhibitPoint[];
  takeaway: string;
  sources: string[];
};

const PRICE_SOURCE_LABEL: Record<string, string> = { yahoo: "Yahoo Finance", nasdaq: "Nasdaq", cnbc: "CNBC", naver: "Naver Finance" };
/** A chart needs this many closes to say anything. */
export const MIN_BARS = 20;

function sideOf(drivers: { id: string; side: ThesisSide }[], driverId: string): ThesisSide {
  const d = drivers.find((x) => x.id === driverId);
  if (!d) throw new Error(`exhibit of driver ${driverId} has no driver row`);
  return d.side;
}

export async function visualInput(db: Db, idea: content.SilverContentIdea, now = new Date()): Promise<VisualInput> {
  const symbol = idea.symbol ?? idea.sourceRefs.find((r) => r.symbol)?.symbol ?? "";
  const since = new Date(now.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const evidenceIds = idea.sourceRefs.filter((r) => r.kind === "evidence").map((r) => r.ref.slice("evidence:".length));
  const citedDrivers = idea.sourceRefs.filter((r) => r.kind === "driver").map((r) => r.ref.slice("driver:".length));
  const [[profile], bars, [fair], items] = await Promise.all([
    db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, symbol)),
    db.select({ date: priceBars.date, close: priceBars.close, sources: priceBars.sources }).from(priceBars).where(and(eq(priceBars.symbol, symbol), gte(priceBars.date, since))).orderBy(asc(priceBars.date)),
    db.select().from(fairValues).where(eq(fairValues.symbol, symbol)),
    evidenceIds.length ? db.select({ id: evidence.id, url: evidence.url, driverId: evidence.driverId, kind: evidence.kind, headline: evidence.headline, publisher: evidence.publisher, at: evidence.eventAt }).from(evidence).where(inArray(evidence.id, evidenceIds)) : [],
  ]);
  // The drivers the Idea rests on: the ones it names, then the ones its Evidence moves.
  const driverIds = [...new Set([...citedDrivers, ...evidenceIds.map((id) => items.find((e) => e.id === id)?.driverId).filter((d): d is string => !!d)])];
  const [drivers, driverExhibits] = driverIds.length
    ? await Promise.all([
        db.select({ id: narrativeDrivers.id, title: narrativeDrivers.title, summary: narrativeDrivers.summary, side: narrativeDrivers.side }).from(narrativeDrivers).where(inArray(narrativeDrivers.id, driverIds)),
        db.select().from(exhibits).where(inArray(exhibits.driverId, driverIds)).orderBy(asc(exhibits.number)),
      ])
    : [[], []];
  const storyRows = await db.select({ side: narratives.side, text: narratives.text }).from(narratives).where(eq(narratives.symbol, symbol));
  const newsUrl = evidenceIds.map((id) => items.find((e) => e.id === id)?.url).find((u): u is string => !!u) ?? null;
  return {
    symbol,
    companyName: profile?.name ?? null,
    title: idea.title,
    bars: bars.map((b) => ({ date: b.date, close: b.close })),
    priceSources: [...new Set(bars.flatMap((b) => b.sources))].map((s) => PRICE_SOURCE_LABEL[s] ?? s),
    fair: fair ? { value: fair.value, currency: fair.currency, low: fair.low, high: fair.high } : null,
    newsUrl,
    news: evidenceIds
      .map((id) => items.find((e) => e.id === id))
      .filter((e): e is (typeof items)[number] & { publisher: string } => !!e && e.kind === "news" && !!e.publisher)
      .map((e) => ({ headline: e.headline, publisher: e.publisher, url: e.url, at: e.at })),
    drivers: drivers.map((d) => ({ title: d.title, summary: d.summary, side: d.side })),
    narratives: storyRows.map((n) => ({ side: n.side, text: n.text })),
    angle: idea.angle,
    exhibits: driverExhibits
      .filter((e) => e.points.some((p) => Object.values(p.values).some((v) => v !== null)))
      .map((e) => ({
        id: e.id,
        driverTitle: drivers.find((d) => d.id === e.driverId)?.title ?? e.driverId,
        side: sideOf(drivers, e.driverId),
        title: e.title,
        chart: e.chart,
        series: e.series,
        points: e.points,
        takeaway: e.takeaway,
        sources: e.sources,
      })),
  };
}
