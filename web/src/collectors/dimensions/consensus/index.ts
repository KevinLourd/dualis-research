import { and, eq, inArray, like, or } from "drizzle-orm";
import { promoteFacts } from "@/bsg/facts";
import { pickWinner, type Assertion, type FactState } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import { consensus, consensusCoverage } from "@/db/schema/consensus";
import type { FieldProvenance } from "@/db/schema/gold";
import { facts, tickers } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { CONSENSUS_SOURCES, type ConsensusReading } from "./sources";

export const CONSENSUS_DIMENSION = "consensus";
const PRIORITY = CONSENSUS_SOURCES.map((s) => s.name);
const RANGE_STATS = ["low", "mean", "high", "analysts"] as const;

export const consensusDim: Dimension = {
  name: CONSENSUS_DIMENSION,
  description:
    "Analyst consensus (low / mean / high, number of analysts) per quarter and fiscal year, and the reported actual. " +
    "US: Nasdaq (Zacks), Yahoo, Finnhub. Korea: Naver (FnGuide), Yahoo. Every other market: Yahoo only. " +
    "Actuals from Yahoo fundamentals, every market. No free source publishes an EBITDA consensus.",
  sources: CONSENSUS_SOURCES,
  subjects: analysedSymbols,
  promote: promoteConsensus,
};

/** silver.facts subject of one (ticker, period, metric): "MNRO|quarter|2026-12|eps". */
export const consensusSubject = (symbol: string, r: Pick<ConsensusReading, "periodType" | "periodEnd" | "metric">) =>
  `${symbol}|${r.periodType}|${r.periodEnd}|${r.metric}`;

/** bronze -> silver.facts (one fact per stat, every agreeing source tag) -> gold.consensus + gold.consensus_coverage. */
export async function promoteConsensus(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const bySubject = new Map<string, Assertion[]>();
  const silverRowsBySource: Record<string, number> = {};
  const readingsOf = new Map<string, ConsensusReading[]>();
  for (const f of ok) {
    const source = CONSENSUS_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`consensus: no extractor for source "${f.source}"`);
    const readings = source.extract(f.payload);
    readingsOf.set(f.id, readings);
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + readings.length;
    for (const r of readings) {
      const subject = consensusSubject(f.subject, r);
      const list = bySubject.get(subject) ?? [];
      for (const [field, value] of Object.entries(r.values)) list.push({ source: f.source, field, value, bronzeId: f.id });
      bySubject.set(subject, list);
    }
  }
  await promoteFacts(db, CONSENSUS_DIMENSION, bySubject);
  const symbols = [...new Set(fetches.map((f) => f.subject))];
  await rebuildGoldConsensus(db, symbols);
  await rebuildCoverage(db, symbols, fetches, readingsOf);
  return { silverRowsBySource };
}

const toState = (r: typeof facts.$inferSelect): FactState => ({ field: r.field, value: r.value, valueKey: r.valueKey, sources: r.sources, bronzeIds: r.bronzeIds });

/**
 * One gold row per (symbol, period, metric). The range (low / mean / high / analysts) is read from ONE source, the
 * one counting the most analysts (then source priority), so a low and a high never come from two different polls;
 * every source agreeing on a value is still listed in its provenance. The actual and currency: `pickWinner`.
 */
export async function rebuildGoldConsensus(db: Db, symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.dimension, CONSENSUS_DIMENSION), or(...symbols.map((s) => like(facts.subject, `${s}|%`)))));
  const bySubject = new Map<string, Map<string, FactState[]>>();
  for (const r of rows) {
    const fields = bySubject.get(r.subject) ?? new Map<string, FactState[]>();
    fields.set(r.field, [...(fields.get(r.field) ?? []), toState(r)]);
    bySubject.set(r.subject, fields);
  }
  const rank = (s: string) => (PRIORITY.indexOf(s) === -1 ? PRIORITY.length : PRIORITY.indexOf(s));
  const goldRows = [...bySubject].map(([subject, fields]) => {
    const [symbol, periodType, periodEnd, metric] = subject.split("|");
    const provenance: FieldProvenance = {};
    const v: Record<string, unknown> = {};
    // The range source: most analysts, then priority, among sources that gave a mean.
    const meanSources = (fields.get("mean") ?? []).flatMap((f) => f.sources);
    const analystsOf = (s: string) => Number((fields.get("analysts") ?? []).find((f) => f.sources.includes(s))?.value ?? 0);
    const rangeSource = [...new Set(meanSources)].sort((a, b) => analystsOf(b) - analystsOf(a) || rank(a) - rank(b))[0];
    for (const stat of RANGE_STATS) {
      const candidates = fields.get(stat) ?? [];
      const chosen = rangeSource ? candidates.find((f) => f.sources.includes(rangeSource)) : undefined;
      v[stat] = chosen?.value ?? null;
      if (chosen) provenance[stat] = { sources: chosen.sources, alternatives: candidates.length - 1 };
    }
    for (const stat of ["actual", "currency"] as const) {
      const candidates = fields.get(stat) ?? [];
      const winner = pickWinner(candidates, { priority: PRIORITY, manual: [] });
      v[stat] = winner?.value ?? null;
      if (winner) provenance[stat] = { sources: winner.sources, alternatives: candidates.length - 1 };
    }
    return {
      symbol,
      periodType: periodType as "quarter" | "year",
      periodEnd,
      metric,
      currency: v.currency as string | null,
      low: v.low as number | null,
      mean: v.mean as number | null,
      high: v.high as number | null,
      analysts: v.analysts === null ? null : Math.round(v.analysts as number),
      actual: v.actual as number | null,
      provenance,
    };
  });
  await db.transaction(async (tx) => {
    await tx.delete(consensus).where(inArray(consensus.symbol, symbols));
    for (let i = 0; i < goldRows.length; i += 500) await tx.insert(consensus).values(goldRows.slice(i, i + 500));
  });
}

/** Per (source, ticker) of this run: what the latest answer held, so the Data page says plainly who has no consensus. */
async function rebuildCoverage(db: Db, symbols: string[], fetches: BronzeFetch[], readingsOf: Map<string, ConsensusReading[]>): Promise<void> {
  if (symbols.length === 0) return;
  const markets = new Map(
    (await db.select({ symbol: tickers.symbol, market: tickers.market }).from(tickers).where(inArray(tickers.symbol, symbols))).map((t) => [t.symbol, t.market]),
  );
  const latest = new Map<string, BronzeFetch>();
  for (const f of [...fetches].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(`${f.source}\u0000${f.subject}`, f);
  const periods = (rs: ConsensusReading[], pick: (r: ConsensusReading) => boolean) => new Set(rs.filter(pick).map((r) => `${r.periodType}|${r.periodEnd}`)).size;
  const now = new Date();
  const rows = CONSENSUS_SOURCES.flatMap((source) =>
    symbols.filter((s) => markets.has(s)).map((symbol) => {
      const base = { source: source.name, symbol, market: markets.get(symbol)!, rebuiltAt: now };
      if (!source.covers(symbol)) return { ...base, status: "not_covered" as const, estimatePeriods: 0, actualPeriods: 0, lastFetchedAt: null, error: null };
      const f = latest.get(`${source.name}\u0000${symbol}`);
      if (!f) return { ...base, status: "failed" as const, estimatePeriods: 0, actualPeriods: 0, lastFetchedAt: null, error: "no answer in the latest run (see the run's errors)" };
      if (f.error) return { ...base, status: "failed" as const, estimatePeriods: 0, actualPeriods: 0, lastFetchedAt: f.fetchedAt, error: f.error };
      const rs = readingsOf.get(f.id) ?? [];
      const estimatePeriods = periods(rs, (r) => r.values.mean !== null && r.values.mean !== undefined);
      const actualPeriods = periods(rs, (r) => r.values.actual !== null && r.values.actual !== undefined);
      const status = estimatePeriods > 0 ? ("estimates" as const) : actualPeriods > 0 ? ("actuals" as const) : ("empty" as const);
      return { ...base, status, estimatePeriods, actualPeriods, lastFetchedAt: f.fetchedAt, error: null };
    }),
  );
  await db.transaction(async (tx) => {
    await tx.delete(consensusCoverage).where(inArray(consensusCoverage.symbol, symbols));
    if (rows.length > 0) await tx.insert(consensusCoverage).values(rows);
  });
}
