import { inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { financialLines, financialMetrics, goldFinancialLines, revenueStreams, valuations, type LineObservation } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { deriveMetrics, deriveValuation } from "./derive";
import { statementOf, type PeriodType } from "./lines";
import { lineConsensus } from "./merge";
import { deriveRevenueStreams } from "./streams";
import { FINANCIALS_PRIORITY, FINANCIALS_SOURCES } from "./sources";

export const FINANCIALS_DIMENSION = "financials";

export const financials: Dimension = {
  name: FINANCIALS_DIMENSION,
  description:
    "Income statement, balance sheet and cash flow, 5 fiscal years + recent quarters and half years, as published, every value with its sources. " +
    "SEC XBRL (US, revenue per segment from the filings), OpenDART (Korea), EDINET (Japan), Yahoo (every market, cross-check), month-end prices for EV, " +
    "and Hong Kong annual and interim reports read by Claude with the page of each figure. Derived: EBITDA, FCF, net debt, margins, growth, EV/EBITDA, " +
    "revenue per stream (growth, share of total, last 12 months).",
  sources: FINANCIALS_SOURCES,
  subjects: analysedSymbols,
  promote: promoteFinancials,
};

const key = (symbol: string, periodType: string, periodEnd: string, line: string) => `${symbol}\u0000${periodType}\u0000${periodEnd}\u0000${line}`;

/**
 * bronze -> silver.financial_lines -> gold.financial_lines + gold.financial_metrics + gold.valuations.
 * A source's latest successful answer for a ticker replaces everything that source said before about it; every
 * other source's observations stay. The shown value per line = the largest group of agreeing sources.
 */
export async function promoteFinancials(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const silverRowsBySource: Record<string, number> = {};
  // Latest answer per (source, ticker).
  const latest = new Map<string, BronzeFetch>();
  for (const f of ok) latest.set(`${f.source}\u0000${f.subject}`, f);
  const symbols = [...new Set([...latest.values()].map((f) => f.subject))];
  if (symbols.length === 0) return { silverRowsBySource };

  const existing = await db.select().from(financialLines).where(inArray(financialLines.symbol, symbols));
  const rows = new Map<string, { symbol: string; periodType: PeriodType; periodEnd: string; line: string; observations: Record<string, LineObservation>; firstSeenAt: Date }>();
  const answered = new Set([...latest.keys()]);
  for (const r of existing) {
    // Drop what a source that answered this run said before: its new answer replaces it.
    const obs = Object.fromEntries(Object.entries(r.observations).filter(([s]) => !answered.has(`${s}\u0000${r.symbol}`)));
    rows.set(key(r.symbol, r.periodType, r.periodEnd, r.line), { symbol: r.symbol, periodType: r.periodType, periodEnd: r.periodEnd, line: r.line, observations: obs, firstSeenAt: r.firstSeenAt });
  }
  for (const f of latest.values()) {
    const source = FINANCIALS_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`financials: no extractor for source "${f.source}"`);
    const readings = source.extract(f.payload);
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + readings.length;
    for (const r of readings) {
      const k = key(f.subject, r.periodType, r.periodEnd, r.line);
      const row = rows.get(k) ?? { symbol: f.subject, periodType: r.periodType, periodEnd: r.periodEnd, line: r.line, observations: {}, firstSeenAt: new Date() };
      row.observations[f.source] = { value: r.value, currency: r.currency, label: r.label, consolidated: r.consolidated, bronzeId: f.id, ...(r.citation ? { citation: r.citation } : {}) };
      rows.set(k, row);
    }
  }

  const now = new Date();
  const silverRows = [...rows.values()]
    .filter((r) => Object.keys(r.observations).length > 0)
    .map((r) => {
      const c = lineConsensus(r.observations, FINANCIALS_PRIORITY);
      const lead = r.observations[c.lead];
      return {
        symbol: r.symbol,
        periodType: r.periodType,
        periodEnd: r.periodEnd,
        line: r.line,
        statement: statementOf(r.line),
        value: lead.value,
        currency: lead.currency,
        label: lead.label,
        consolidated: lead.consolidated,
        sources: c.sources,
        bronzeIds: c.sources.map((s) => r.observations[s].bronzeId),
        observations: r.observations,
        firstSeenAt: r.firstSeenAt,
        lastRebuiltAt: now,
        alternatives: c.alternatives,
        citation: c.sources.map((s) => r.observations[s].citation).find(Boolean) ?? null,
      };
    });

  await db.transaction(async (tx) => {
    await tx.delete(financialLines).where(inArray(financialLines.symbol, symbols));
    for (let i = 0; i < silverRows.length; i += 500) {
      await tx.insert(financialLines).values(silverRows.slice(i, i + 500).map(({ alternatives, citation, ...r }) => (void alternatives, void citation, r)));
    }
  });

  await rebuildGold(db, symbols, silverRows);
  return { silverRowsBySource };
}

type SilverRow = {
  symbol: string;
  periodType: PeriodType;
  periodEnd: string;
  line: string;
  statement: ReturnType<typeof statementOf>;
  value: number;
  currency: string | null;
  label: string;
  consolidated: boolean | null;
  sources: string[];
  alternatives: { source: string; value: number }[];
  citation: LineObservation["citation"] | null;
};

async function rebuildGold(db: Db, symbols: string[], silverRows: SilverRow[]): Promise<void> {
  const quotes = new Map((await db.select().from(gold.quotes).where(inArray(gold.quotes.symbol, symbols))).map((q) => [q.symbol, q]));
  const goldLines = silverRows.map((r) => ({
    symbol: r.symbol,
    periodType: r.periodType,
    periodEnd: r.periodEnd,
    line: r.line,
    statement: r.statement,
    value: r.value,
    currency: r.currency,
    label: r.label,
    consolidated: r.consolidated,
    sources: r.sources,
    alternatives: r.alternatives,
    citation: r.citation ?? null,
  }));
  const metricRows: ReturnType<typeof deriveMetrics> = [];
  const valuationRows: ReturnType<typeof deriveValuation>[] = [];
  const streamRows: ReturnType<typeof deriveRevenueStreams> = [];
  for (const symbol of symbols) {
    const lines = goldLines.filter((l) => l.symbol === symbol);
    streamRows.push(...deriveRevenueStreams(symbol, lines));
    const metrics = deriveMetrics(symbol, lines);
    metricRows.push(...metrics);
    const q = quotes.get(symbol);
    valuationRows.push(deriveValuation(symbol, lines, metrics, q ? { date: q.date, close: q.close, currency: q.currency } : null));
  }
  await db.transaction(async (tx) => {
    await tx.delete(goldFinancialLines).where(inArray(goldFinancialLines.symbol, symbols));
    await tx.delete(financialMetrics).where(inArray(financialMetrics.symbol, symbols));
    await tx.delete(valuations).where(inArray(valuations.symbol, symbols));
    await tx.delete(revenueStreams).where(inArray(revenueStreams.symbol, symbols));
    for (let i = 0; i < streamRows.length; i += 500) await tx.insert(revenueStreams).values(streamRows.slice(i, i + 500));
    for (let i = 0; i < goldLines.length; i += 500) await tx.insert(goldFinancialLines).values(goldLines.slice(i, i + 500));
    for (let i = 0; i < metricRows.length; i += 500) await tx.insert(financialMetrics).values(metricRows.slice(i, i + 500));
    if (valuationRows.length) await tx.insert(valuations).values(valuationRows);
  });
}
