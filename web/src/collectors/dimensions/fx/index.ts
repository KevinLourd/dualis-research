import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { fxRates as silverFx } from "@/db/schema/silver";
import { theses } from "@/db/schema/thesis";
import { valuations } from "@/db/schema/financials";
import type { Db } from "@/db/types";
import { getJson } from "../../http";
import { isoDate } from "../../markets";
import type { Dimension, PromoteResult, Source } from "../../types";
import { majorUnit } from "../financials/derive";
import { analysedSymbols } from "../watchlist";

/**
 * Exchange rates (NO-NARRATIVE-1110): a dual-listed company reports in one currency and trades in another (Obsidian
 * Energy: CAD statements, NYSE quote in USD). The valuation stays in the reporting currency (every multiple, DCF and
 * bridge line is read there); the Fair Value is shown and compared in the QUOTE currency, the price its investors see,
 * converted at the stored daily rate. Subject = `<reporting>/<quote>` (`CAD/USD`), only for the pairs an analysed
 * ticker needs. Yahoo chart `CADUSD=X`, free, no key.
 */
export const FX_DIMENSION = "fx";
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };

export const pairOf = (from: string, to: string) => `${from}/${to}`;
export function parsePair(subject: string): { base: string; quote: string } {
  const [base, quote] = subject.split("/");
  if (!/^[A-Z]{3}$/.test(base ?? "") || !/^[A-Z]{3}$/.test(quote ?? "")) throw new Error(`"${subject}" is not a currency pair <BASE>/<QUOTE>`);
  return { base, quote };
}

type YahooChart = { meta: { currency?: string; gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } };

export const yahooFx: Source & { extract: (payload: unknown) => { date: string; rate: number }[] } = {
  name: "yahoo",
  requiredEnv: [],
  covers: () => true,
  async fetch(subject, ctx) {
    const { base, quote } = parsePair(subject);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${base}${quote}%3DX?range=1y&interval=1d`;
    const out = await getJson(ctx, url, { url, pair: subject }, { headers: YAHOO_HEADERS });
    if (!out.error && !(out.payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0]) return { ...out, error: `Yahoo returned no chart for ${base}${quote}=X` };
    return out;
  },
  extract(payload) {
    const r = (payload as { chart: { result: YahooChart[] } }).chart.result[0];
    const close = r.indicators?.quote?.[0]?.close ?? [];
    const offset = r.meta.gmtoffset ?? 0;
    const byDay = new Map<string, number>();
    (r.timestamp ?? []).forEach((ts, i) => {
      const c = close[i];
      if (typeof c === "number" && c > 0) byDay.set(isoDate(new Date((ts + offset) * 1000)), c);
    });
    return [...byDay].map(([date, rate]) => ({ date, rate }));
  },
};

/** The currency a ticker's fair value is computed in: Thierry's own number's, else the reporting currency. */
export async function fairValueCurrencies(db: Db, symbols: string[]): Promise<Map<string, string>> {
  if (symbols.length === 0) return new Map();
  const [vs, ts] = await Promise.all([
    db.select({ symbol: valuations.symbol, currency: valuations.currency }).from(valuations).where(inArray(valuations.symbol, symbols)),
    db.select({ symbol: theses.symbol, currency: theses.currency, fairValue: theses.fairValue }).from(theses).where(inArray(theses.symbol, symbols)),
  ]);
  const out = new Map<string, string>();
  for (const v of vs) if (v.currency) out.set(v.symbol, v.currency);
  for (const t of ts) if (t.fairValue !== null && t.currency) out.set(t.symbol, t.currency);
  return out;
}

/** The quote currency in major units (GBp -> GBP), per ticker. */
export async function quoteCurrencies(db: Db, symbols: string[]): Promise<Map<string, string>> {
  if (symbols.length === 0) return new Map();
  const qs = await db.select({ symbol: gold.quotes.symbol, close: gold.quotes.close, currency: gold.quotes.currency }).from(gold.quotes).where(inArray(gold.quotes.symbol, symbols));
  const out = new Map<string, string>();
  for (const q of qs) {
    const c = majorUnit(q.close, q.currency).currency;
    if (c) out.set(q.symbol, c);
  }
  return out;
}

/** Every pair an analysed ticker needs: fair value currency -> quote currency, where they differ. */
export async function neededPairs(db: Db): Promise<string[]> {
  const symbols = await analysedSymbols(db);
  const [fv, q] = await Promise.all([fairValueCurrencies(db, symbols), quoteCurrencies(db, symbols)]);
  const pairs = new Set<string>();
  for (const s of symbols) {
    const from = fv.get(s);
    const to = q.get(s);
    if (from && to && from !== to) pairs.add(pairOf(from, to));
  }
  return [...pairs].sort();
}

export const fxDim: Dimension = {
  name: FX_DIMENSION,
  description: "Daily exchange rates (Yahoo), only for the pairs an analysed ticker needs: a fair value computed in the reporting currency (CAD statements) shown and compared in the quote currency (a USD listing).",
  sources: [yahooFx],
  subjects: neededPairs,
  promote: promoteFx,
};

export async function promoteFx(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const pairs = new Set<string>();
  for (const f of fetches.filter((x) => !x.error)) {
    const { base, quote } = parsePair(f.subject);
    pairs.add(f.subject);
    const rows = yahooFx.extract(f.payload);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ base, quote, date: r.date, rate: r.rate, sources: [f.source], bronzeIds: [f.id] }));
      await db
        .insert(silverFx)
        .values(chunk)
        .onConflictDoUpdate({
          target: [silverFx.base, silverFx.quote, silverFx.date],
          set: {
            rate: sql`excluded.rate`,
            sources: sql`(select array_agg(distinct s order by s) from unnest(${silverFx.sources} || excluded.sources) s)`,
            bronzeIds: sql`${silverFx.bronzeIds} || excluded.bronze_ids`,
            lastSeenAt: sql`now()`,
          },
        });
      n += chunk.length;
    }
  }
  for (const pair of pairs) {
    const { base, quote } = parsePair(pair);
    const rows = await db.select({ date: silverFx.date, rate: silverFx.rate, sources: silverFx.sources }).from(silverFx).where(and(eq(silverFx.base, base), eq(silverFx.quote, quote)));
    await db.transaction(async (tx) => {
      await tx.delete(gold.fxRates).where(and(eq(gold.fxRates.base, base), eq(gold.fxRates.quote, quote)));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(gold.fxRates).values(rows.slice(i, i + 500).map((r) => ({ base, quote, ...r })));
    });
  }
  return { silverRowsBySource: { yahoo: n } };
}

export type FxSeries = { base: string; quote: string; points: { date: string; rate: number; sources: string[] }[] };

/** A pair's stored daily rates, oldest first (gold.fx_rates). */
export async function fxSeries(db: Db, base: string, quote: string): Promise<FxSeries> {
  const points = await db.select({ date: gold.fxRates.date, rate: gold.fxRates.rate, sources: gold.fxRates.sources }).from(gold.fxRates).where(and(eq(gold.fxRates.base, base), eq(gold.fxRates.quote, quote))).orderBy(asc(gold.fxRates.date));
  return { base, quote, points };
}

/** The rate known on `day` (the last close on or before it); without `day`, the latest one. Null when none is stored. */
export function rateOn(series: FxSeries, day?: string): { rate: number; date: string; source: string } | null {
  let hit: FxSeries["points"][number] | undefined;
  for (const p of series.points) {
    if (day && p.date > day) break;
    hit = p;
  }
  // A day before the first stored rate: the first one (the nearest close we hold), said by its own date.
  if (!hit && day) hit = series.points[0];
  return hit ? { rate: hit.rate, date: hit.date, source: hit.sources.join(", ") } : null;
}

/** One reader per run: each pair read once, then `rate(from, to, day?)` (null when from = to is not needed or no rate is stored). */
export function fxReader(db: Db): (from: string, to: string, day?: string) => Promise<{ rate: number; date: string; source: string } | null> {
  const cache = new Map<string, Promise<FxSeries>>();
  return async (from, to, day) => {
    const key = pairOf(from, to);
    let s = cache.get(key);
    if (!s) cache.set(key, (s = fxSeries(db, from, to)));
    return rateOn(await s, day);
  };
}
