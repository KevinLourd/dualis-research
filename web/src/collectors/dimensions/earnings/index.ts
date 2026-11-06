import { and, eq, inArray, like, or } from "drizzle-orm";
import { promoteFacts } from "@/bsg/facts";
import { pickWinner, type Assertion, type FactState } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import type { FieldProvenance } from "@/db/schema/gold";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { EARNINGS_FIELDS, EARNINGS_SOURCES } from "./sources";

export const EARNINGS_DIMENSION = "earnings";
/** Nasdaq (Zacks consensus) is trusted over Finnhub when they disagree and no majority exists. */
const PRIORITY = EARNINGS_SOURCES.map((s) => s.name);

export const earnings: Dimension = {
  name: EARNINGS_DIMENSION,
  description: "Earnings calendar and past results: report date, EPS and revenue, estimate vs actual.",
  sources: EARNINGS_SOURCES,
  subjects: analysedSymbols,
  promote: promoteEarnings,
};

/** silver.facts subject of one fiscal quarter of one ticker: "MNRO|2026-09". */
export const earningsSubject = (symbol: string, period: string) => `${symbol}|${period}`;

/** bronze -> silver.facts (one fact per quarter x field, every agreeing source) -> gold.earnings. */
export async function promoteEarnings(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const bySubject = new Map<string, Assertion[]>();
  const silverRowsBySource: Record<string, number> = {};
  for (const f of ok) {
    const source = EARNINGS_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`earnings: no extractor for source "${f.source}"`);
    const items = source.extract(f.payload);
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + items.length;
    for (const item of items) {
      const subject = earningsSubject(f.subject, item.period);
      const list = bySubject.get(subject) ?? [];
      for (const [field, value] of Object.entries(item.values)) list.push({ source: f.source, field, value, bronzeId: f.id });
      bySubject.set(subject, list);
    }
  }
  await promoteFacts(db, EARNINGS_DIMENSION, bySubject);
  await rebuildGoldEarnings(db, [...new Set(ok.map((f) => f.subject))]);
  return { silverRowsBySource };
}

export async function rebuildGoldEarnings(db: Db, symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.dimension, EARNINGS_DIMENSION), or(...symbols.map((s) => like(facts.subject, `${s}|%`)))));
  const bySubject = new Map<string, Map<string, FactState[]>>();
  for (const r of rows) {
    const fields = bySubject.get(r.subject) ?? new Map<string, FactState[]>();
    fields.set(r.field, [...(fields.get(r.field) ?? []), { field: r.field, value: r.value, valueKey: r.valueKey, sources: r.sources, bronzeIds: r.bronzeIds }]);
    bySubject.set(r.subject, fields);
  }
  const goldRows = [...bySubject].map(([subject, fields]) => {
    const [symbol, period] = subject.split("|");
    const provenance: FieldProvenance = {};
    const v: Record<string, unknown> = {};
    for (const field of EARNINGS_FIELDS) {
      const candidates = fields.get(field) ?? [];
      const winner = pickWinner(candidates, { priority: PRIORITY, manual: [] });
      v[field] = winner?.value ?? null;
      if (winner) provenance[field] = { sources: winner.sources, alternatives: candidates.length - 1 };
    }
    return {
      symbol,
      period,
      reportDate: v.reportDate as string | null,
      hour: v.hour as string | null,
      epsActual: v.epsActual as number | null,
      epsEstimate: v.epsEstimate as number | null,
      revenueActual: v.revenueActual as number | null,
      revenueEstimate: v.revenueEstimate as number | null,
      provenance,
    };
  });
  await db.delete(gold.earnings).where(inArray(gold.earnings.symbol, symbols));
  for (let i = 0; i < goldRows.length; i += 500) await db.insert(gold.earnings).values(goldRows.slice(i, i + 500));
}
