import { cache } from "react";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companyProfiles, quotes, tickers } from "@/db/schema/gold";
import { consensus, consensusCoverage } from "@/db/schema/consensus";
import { goldOperatingKpis } from "@/db/schema/financials";
import { runSources, runs } from "@/db/schema/ops";

/** Console reads: gold for business data, ops for run health. Never bronze or silver. */

export type TickerRow = Awaited<ReturnType<typeof listTickers>>[number];

export async function listTickers() {
  return getDb()
    .select({
      symbol: tickers.symbol,
      market: tickers.market,
      inPortfolio: tickers.inPortfolio,
      position: tickers.position,
      aliases: tickers.aliases,
      thesisNote: tickers.thesisNote,
      name: companyProfiles.name,
      exchange: companyProfiles.exchange,
      currency: companyProfiles.currency,
      sector: companyProfiles.sector,
      industry: companyProfiles.industry,
      marketCap: companyProfiles.marketCap,
      logoUrl: companyProfiles.logoUrl,
      lastClose: quotes.close,
      changePct: quotes.changePct,
      quoteCurrency: quotes.currency,
      quoteDate: quotes.date,
    })
    .from(tickers)
    .leftJoin(companyProfiles, eq(companyProfiles.symbol, tickers.symbol))
    .leftJoin(quotes, eq(quotes.symbol, tickers.symbol))
    .orderBy(desc(tickers.inPortfolio), asc(tickers.symbol));
}

/** One ticker with its profile and last quote: three reads at once, made once per request (layout + page share it). */
export const getTicker = cache(async (symbol: string) => {
  const db = getDb();
  const [[ticker], [profile], [quote]] = await Promise.all([
    db.select().from(tickers).where(eq(tickers.symbol, symbol)),
    db.select().from(companyProfiles).where(eq(companyProfiles.symbol, symbol)),
    db.select().from(quotes).where(eq(quotes.symbol, symbol)),
  ]);
  if (!ticker) return null;
  return { ticker, profile: profile ?? null, quote: quote ?? null };
});

/** Analyst consensus vs actual per (period, metric), newest period first (gold.consensus). */
export async function consensusOf(symbol: string) {
  return getDb()
    .select()
    .from(consensus)
    .where(eq(consensus.symbol, symbol))
    .orderBy(desc(consensus.periodEnd), asc(consensus.periodType), asc(consensus.metric));
}

/** The operating KPIs a ticker reports (backlog, orders...), newest period first (Analysis page). */
export async function operatingKpisOf(symbol: string) {
  return getDb().select().from(goldOperatingKpis).where(eq(goldOperatingKpis.symbol, symbol)).orderBy(desc(goldOperatingKpis.periodEnd), asc(goldOperatingKpis.kpi));
}

/** Per (source, ticker), what the latest consensus run got (Data page). */
export async function listConsensusCoverage() {
  return getDb().select().from(consensusCoverage).orderBy(asc(consensusCoverage.symbol), asc(consensusCoverage.source));
}

export async function listRuns(limit = 50) {
  return getDb().select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
}

export async function sourcesOfRuns(runIds: string[]) {
  if (runIds.length === 0) return [];
  return getDb().select().from(runSources).where(inArray(runSources.runId, runIds)).orderBy(asc(runSources.source));
}

export async function getRun(id: string) {
  const db = getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  const sources = await db.select().from(runSources).where(eq(runSources.runId, id)).orderBy(asc(runSources.source));
  return { run, sources };
}

/** Latest finished-or-running run per dimension. */
export async function latestRunPerDimension() {
  const recent = await listRuns(100);
  const seen = new Map<string, (typeof recent)[number]>();
  for (const r of recent) if (!seen.has(r.dimension)) seen.set(r.dimension, r);
  return [...seen.values()];
}

export async function lastRun() {
  const [run] = await getDb().select().from(runs).orderBy(desc(runs.startedAt)).limit(1);
  return run ?? null;
}

/** The analysis read contract (Signal, Fair Value, Narrative, Drivers, Exhibits, Evidence, Report): `analysis-queries.ts`. */
export * from "./analysis-queries";
