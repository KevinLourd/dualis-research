import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { fairValueHistory, fairValues, marketReactions, type GoldFairValueHistory, type GoldMarketReaction } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import { valuationSyntheses } from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import { BENCHMARK } from "../../benchmark";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { itemsOf, EVIDENCE_WINDOW_DAYS } from "../evidence/items";
import { majorUnit } from "../financials/derive";
import { analysedSymbols } from "../watchlist";
import { reactionOf, type Bar, type FvPoint } from "./compute";

export * from "./compute";

/**
 * Market Reaction + Fair Value History (Kevin 2026-11-09: the judges must see the fair value, its range and the price
 * at each key moment). Pure code over stored data, no fetch, no LLM: the history of the fair value (one point a day,
 * from every valuation synthesis) and, per news item and filing of the year, what the price did around it vs the
 * S&P 500. Runs after `valuation`, before the judges.
 */

export const MARKET_REACTION_DIMENSION = "market-reaction";

type Payload = { history: Omit<GoldFairValueHistory, "rebuiltAt">[]; reactions: Omit<GoldMarketReaction, "rebuiltAt">[] };

/** Closes of the evidence window plus a margin, oldest first, in major units. */
async function closes(db: Db, symbol: string, currency: string | null): Promise<Bar[]> {
  const from = new Date(Date.now() - (EVIDENCE_WINDOW_DAYS + 20) * 86_400_000).toISOString().slice(0, 10);
  const bars = await db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(and(eq(gold.priceBars.symbol, symbol), gte(gold.priceBars.date, from))).orderBy(asc(gold.priceBars.date));
  return bars.map((b) => ({ date: b.date, close: majorUnit(b.close, currency).price }));
}

/** One read of the benchmark per run (keyed on the run's fetch function), not one per ticker. */
const runBench = new WeakMap<typeof fetch, Promise<Bar[]>>();

/** The fair value each day: the last synthesis of the day (silver.valuation_syntheses keeps every one). */
export async function fairValuePoints(db: Db, symbol: string): Promise<(FvPoint & { currency: string | null })[]> {
  // Egress: the four figures only, never the stored report text.
  const r = valuationSyntheses.result;
  const rows = await db
    .select({ createdAt: valuationSyntheses.createdAt, base: sql<string | null>`${r}->>'base'`, low: sql<string | null>`${r}->>'low'`, high: sql<string | null>`${r}->>'high'`, currency: sql<string | null>`${r}->>'currency'` })
    .from(valuationSyntheses)
    .where(eq(valuationSyntheses.symbol, symbol))
    .orderBy(asc(valuationSyntheses.createdAt));
  const num = (v: string | null) => (v === null ? null : Number(v));
  const byDay = new Map<string, FvPoint & { currency: string | null }>();
  for (const x of rows) {
    const base = num(x.base);
    if (base === null || !(base > 0)) continue;
    const day = x.createdAt.toISOString().slice(0, 10);
    byDay.set(day, { day, value: base, low: num(x.low), high: num(x.high), currency: x.currency });
  }
  return [...byDay.values()];
}

export const marketReactionSource: Source = {
  name: "rules",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("market-reaction: needs the database");
    const db = ctx.db;
    const [[q], [fv]] = await Promise.all([db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol)), db.select().from(fairValues).where(eq(fairValues.symbol, symbol))]);
    const currency = q?.currency ?? null;
    let bench = runBench.get(ctx.fetch);
    if (!bench) runBench.set(ctx.fetch, (bench = closes(db, BENCHMARK, null)));
    const [bars, benchBars, points, items] = await Promise.all([closes(db, symbol, currency), bench, fairValuePoints(db, symbol), itemsOf(db, symbol)]);
    const now: FvPoint | null = fv ? { day: (fv.asOf ?? new Date()).toISOString().slice(0, 10), value: fv.value, low: fv.low, high: fv.high } : null;
    const major = currency ? majorUnit(1, currency).currency : null;
    const reactions = items.map((it) => reactionOf({ id: `${symbol}|${it.kind}:${it.id}`, symbol, day: it.at.toISOString().slice(0, 10) }, bars, benchBars, points, now, fv?.currency ?? major));
    const history = points.map((p) => ({ id: `${symbol}|${p.day}`, symbol, day: p.day, value: p.value, low: p.low, high: p.high, currency: p.currency }));
    const payload: Payload = { history, reactions };
    return { request: { symbol, items: items.length, bars: bars.length }, httpStatus: null, payload };
  },
};

export const marketReactionDim: Dimension = {
  name: MARKET_REACTION_DIMENSION,
  description: "Per analysed ticker: the fair value as it stood each day (base, low, high), and for every news item and filing of the year what the price did around it (close before, next close, five closes later, today) vs the S&P 500, with the fair value then and now. Code only, from stored data.",
  sources: [marketReactionSource],
  subjects: analysedSymbols,
  promote: async (db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: { rules: await promoteMarketReactions(db, fetches) } }),
};

/** Gold from this run's latest answer per ticker: its rows replace the ticker's old ones. */
export async function promoteMarketReactions(db: Db, fetches: BronzeFetch[]): Promise<number> {
  const latest = new Map<string, Payload>();
  for (const f of fetches.filter((x) => !x.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f.payload as Payload);
  const symbols = [...latest.keys()];
  if (symbols.length === 0) return 0;
  const history = [...latest.values()].flatMap((p) => p.history);
  const reactions = [...latest.values()].flatMap((p) => p.reactions);
  await db.transaction(async (tx) => {
    await tx.delete(fairValueHistory).where(inArray(fairValueHistory.symbol, symbols));
    await tx.delete(marketReactions).where(inArray(marketReactions.symbol, symbols));
    if (history.length) await tx.insert(fairValueHistory).values(history);
    for (let i = 0; i < reactions.length; i += 500) await tx.insert(marketReactions).values(reactions.slice(i, i + 500));
  });
  return history.length + reactions.length;
}

/** The stored reactions of a ticker by Evidence id (what the judges read). */
export async function reactionsOf(db: Db, symbol: string): Promise<Map<string, GoldMarketReaction>> {
  const rows = await db.select().from(marketReactions).where(eq(marketReactions.symbol, symbol));
  return new Map(rows.map((r) => [r.id, r]));
}
