import { cache } from "react";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  evidence,
  exhibits,
  fairValues,
  narrativeDrivers,
  narrativeRationales,
  narratives,
  narrativeStates,
  researchReports,
  signalChanges,
  signals,
  type GoldEvidence,
  type GoldExhibit,
  type GoldFairValue,
  type GoldNarrativeDriver,
  type GoldNarrativeRationale,
  type GoldNarrativeState,
  type GoldResearchReport,
  type GoldSignal,
  type GoldSignalChange,
} from "@/db/schema/analysis";
import { goldMethodValuations, valuationMethods, valuationReports } from "@/db/schema/valuation";
import { financialMetrics, goldFinancialLines, valuations, type GoldFinancialLine, type GoldFinancialMetric, type GoldValuation } from "@/db/schema/financials";
import { companyProfiles, tickers } from "@/db/schema/gold";

/**
 * The analysis read contract (gold only), for the console UI. Names = Kevin's business objects:
 * Signal, Signal Change, Fair Value, Quote, Narrative, Narrative Driver, Driver Category, Exhibit, Evidence,
 * Research Report, Update Note.
 */

/** Signals list: one row per active ticker with its signal, strength, fair value + method, quote and gap. */
export async function listAnalysisSignals() {
  return getDb()
    .select({
      symbol: signals.symbol,
      name: companyProfiles.name,
      market: tickers.market,
      position: tickers.position,
      inPortfolio: tickers.inPortfolio,
      signal: signals.signal,
      strength: signals.strength,
      fairValue: signals.fairValue,
      fairValueMethod: signals.fairValueMethod,
      fairValueLabel: signals.fairValueLabel,
      currency: signals.currency,
      quote: signals.quote,
      quoteDate: signals.quoteDate,
      gapPct: signals.gapPct,
      since: signals.since,
      evidenceIds: signals.evidenceIds,
    })
    .from(signals)
    .innerJoin(tickers, eq(tickers.symbol, signals.symbol))
    .leftJoin(companyProfiles, eq(companyProfiles.symbol, signals.symbol))
    .orderBy(asc(signals.symbol));
}
export type AnalysisSignalRow = Awaited<ReturnType<typeof listAnalysisSignals>>[number];

/** Signal Changes, newest first, each with its Update Note. */
export async function listSignalChanges(limit = 100): Promise<GoldSignalChange[]> {
  return getDb().select().from(signalChanges).orderBy(desc(signalChanges.at)).limit(limit);
}

/** A driver with its Exhibits, the news that bear on it (non-noise verdict for THIS driver, newest first) and its tag. */
export type DriverWithExhibits = GoldNarrativeDriver & { exhibits: GoldExhibit[]; evidence: GoldEvidence[]; state: GoldNarrativeState | null };

/** The news that bear on one driver: its own verdict is not noise. */
export const bearsOn = (e: GoldEvidence, driverId: string) => e.verdicts.some((v) => v.driverId === driverId && v.effect !== "noise");

export type TickerAnalysis = {
  symbol: string;
  signal: GoldSignal | null;
  fairValue: GoldFairValue | null;
  /** text = ONE sentence; detail = the longer why (item panel). */
  narrative: { text: string; detail: string | null; asOf: Date } | null;
  /** Narrative Rationale: why the market holds the story, claims with drivers and sources, its own exhibits. */
  rationale: (GoldNarrativeRationale & { exhibits: GoldExhibit[] }) | null;
  /** Rank order, max 3; each with its Exhibits (chart data inside) and the Evidence judged against it, newest first. */
  drivers: DriverWithExhibits[];
  /** Where the whole narrative stands (ticker-level tag), from its drivers' tags. */
  narrativeState: GoldNarrativeState | null;
  /** Every judged news item and filing of the year, newest first, each with one verdict per driver. */
  evidence: GoldEvidence[];
  report: GoldResearchReport | null;
  signalChanges: GoldSignalChange[];
};

/** Everything the panel / Analysis page shows for one ticker: reads in parallel, once per request. */
export const getTickerAnalysis = cache(async (symbol: string): Promise<TickerAnalysis> => {
  const db = getDb();
  const [[signal], [fairValue], [narrative], drivers, ex, ev, [report], changes, [rationale], states] = await Promise.all([
    db.select().from(signals).where(eq(signals.symbol, symbol)),
    db.select().from(fairValues).where(eq(fairValues.symbol, symbol)),
    db.select().from(narratives).where(eq(narratives.symbol, symbol)),
    db.select().from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol)).orderBy(asc(narrativeDrivers.rank)),
    db.select().from(exhibits).where(eq(exhibits.symbol, symbol)).orderBy(asc(exhibits.number)),
    db.select().from(evidence).where(eq(evidence.symbol, symbol)).orderBy(desc(evidence.eventAt)),
    db.select().from(researchReports).where(eq(researchReports.symbol, symbol)),
    db.select().from(signalChanges).where(eq(signalChanges.symbol, symbol)).orderBy(desc(signalChanges.at)),
    db.select().from(narrativeRationales).where(eq(narrativeRationales.symbol, symbol)),
    db.select().from(narrativeStates).where(eq(narrativeStates.symbol, symbol)),
  ]);
  return {
    symbol,
    signal: signal ?? null,
    fairValue: fairValue ?? null,
    narrative: narrative ? { text: narrative.text, detail: narrative.detail, asOf: narrative.asOf } : null,
    rationale: rationale ? { ...rationale, exhibits: ex.filter((e) => e.driverId === `${symbol}:rationale`) } : null,
    drivers: drivers.map((d) => ({ ...d, exhibits: ex.filter((e) => e.driverId === d.id), evidence: ev.filter((e) => bearsOn(e, d.id)), state: states.find((s) => s.level === "driver" && s.driverId === d.id) ?? null })),
    narrativeState: states.find((s) => s.level === "ticker") ?? null,
    evidence: ev,
    report: report ?? null,
    signalChanges: changes,
  };
});

/** One Exhibit (level C panel): its chart data and sources. */
export async function getExhibit(id: string): Promise<GoldExhibit | null> {
  return (await getDb().select().from(exhibits).where(eq(exhibits.id, id)))[0] ?? null;
}

/** One Evidence item (level C panel): judgment, cited sentence, the driver and exhibit it points to. */
export async function getEvidence(id: string): Promise<GoldEvidence | null> {
  return (await getDb().select().from(evidence).where(eq(evidence.id, id)))[0] ?? null;
}

/** Financial statements of a ticker (level C figure panel): every line with sources, derived metrics, valuation. */
export async function getFinancials(symbol: string): Promise<{ lines: GoldFinancialLine[]; metrics: GoldFinancialMetric[]; valuation: GoldValuation | null }> {
  const db = getDb();
  const [lines, metrics, [valuation]] = await Promise.all([
    db.select().from(goldFinancialLines).where(and(eq(goldFinancialLines.symbol, symbol))).orderBy(asc(goldFinancialLines.periodEnd)),
    db.select().from(financialMetrics).where(eq(financialMetrics.symbol, symbol)).orderBy(asc(financialMetrics.periodEnd)),
    db.select().from(valuations).where(eq(valuations.symbol, symbol)),
  ]);
  return { lines, metrics, valuation: valuation ?? null };
}

/** The fair value pyramid of one ticker: the Valuation Report, every Method Valuation (catalogue order), the Fair Value. */
export const getValuation = cache(async (symbol: string) => {
  const db = getDb();
  const [[report], methods, catalogue, [fairValue], [quote]] = await Promise.all([
    db.select().from(valuationReports).where(eq(valuationReports.symbol, symbol)),
    db.select().from(goldMethodValuations).where(eq(goldMethodValuations.symbol, symbol)),
    db.select().from(valuationMethods).orderBy(asc(valuationMethods.rank)),
    db.select().from(fairValues).where(eq(fairValues.symbol, symbol)),
    db.select({ quote: signals.quote }).from(signals).where(eq(signals.symbol, symbol)),
  ]);
  const byId = new Map(methods.map((m) => [m.method, m]));
  return {
    report: report ?? null,
    fairValue: fairValue ?? null,
    quote: quote?.quote ?? null,
    methods: catalogue.flatMap((c) => {
      const m = byId.get(c.id);
      return m ? [{ ...m, name: c.name, family: c.family, description: c.description, weight: report?.weights.find((w) => w.method === c.id) ?? null }] : [];
    }),
  };
});
export type Valuation = Awaited<ReturnType<typeof getValuation>>;
