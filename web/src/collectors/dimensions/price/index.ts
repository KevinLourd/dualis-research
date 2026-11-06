import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { priceBars, type PriceObservation } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { activeSymbols } from "../watchlist";
import { priceConsensus } from "./consensus";
import { PRICE_SOURCES } from "./sources";

export const PRICE_DIMENSION = "price";
import { BENCHMARK } from "../../benchmark";
const BATCH = 500;

export const price: Dimension = {
  name: PRICE_DIMENSION,
  description: "Daily price history (five years from Yahoo, one year from the others, every market), last close and day change; plus the S&P 500 (^GSPC).",
  sources: PRICE_SOURCES,
  subjects: async (db) => [...(await activeSymbols(db)), BENCHMARK],
  promote: promotePrices,
};

type Row = typeof priceBars.$inferInsert;

/** Bars older than this many days before a ticker's last stored bar are history: a refetch never rewrites them. */
export const PRICE_REWRITE_DAYS = 14;

/**
 * bronze -> silver.price_bars: every source's bar is kept in `observations`; the shown bar comes from the group of
 * sources whose closes agree (`priceConsensus`). Then gold.price_bars and gold.quotes for the dates touched.
 * Egress (Neon free plan, 5 GB/month): a run reads back only the recent window (dates within PRICE_REWRITE_DAYS of the
 * last stored bar), never the five years Yahoo returns each time. A stored older date is skipped; a missing one is added.
 */
export async function promotePrices(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const silverRowsBySource: Record<string, number> = {};
  const symbols = [...new Set(ok.map((f) => f.subject))];

  for (const symbol of symbols) {
    const storedDates = new Set((await db.select({ date: priceBars.date }).from(priceBars).where(eq(priceBars.symbol, symbol))).map((r) => r.date));
    const last = [...storedDates].sort().at(-1);
    const cutoff = last ? new Date(Date.parse(`${last}T00:00:00Z`) - PRICE_REWRITE_DAYS * 86_400_000).toISOString().slice(0, 10) : null;
    const recent = cutoff
      ? await db
          .select({ date: priceBars.date, observations: priceBars.observations, bronzeIds: priceBars.bronzeIds, currency: priceBars.currency })
          .from(priceBars)
          .where(and(eq(priceBars.symbol, symbol), gte(priceBars.date, cutoff)))
      : [];
    const byDate = new Map<string, { observations: Record<string, PriceObservation>; bronzeIds: string[]; currency: string | null }>(
      recent.map((r) => [r.date, { observations: { ...r.observations }, bronzeIds: r.bronzeIds, currency: r.currency }]),
    );
    for (const f of ok.filter((x) => x.subject === symbol)) {
      const source = PRICE_SOURCES.find((s) => s.name === f.source);
      if (!source) throw new Error(`price: no extractor for source "${f.source}"`);
      const { currency, bars } = source.extract(f.payload ?? f.payloadText);
      for (const bar of bars) {
        if (cutoff && bar.date < cutoff && storedDates.has(bar.date)) continue;
        silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + 1;
        const day = byDate.get(bar.date) ?? { observations: {}, bronzeIds: [], currency: null };
        day.observations[f.source] = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, bronzeId: f.id } satisfies PriceObservation;
        day.currency ??= currency;
        byDate.set(bar.date, day);
      }
    }
    const rows: Row[] = [...byDate].map(([date, day]) => {
      const c = priceConsensus(day.observations);
      const lead = day.observations[c.lead];
      return {
        symbol,
        date,
        open: lead.open,
        high: lead.high,
        low: lead.low,
        close: lead.close,
        volume: lead.volume,
        currency: day.currency,
        sources: c.sources,
        bronzeIds: c.sources.map((s) => day.observations[s].bronzeId),
        observations: day.observations,
        lastSeenAt: new Date(),
      };
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      await db
        .insert(priceBars)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: [priceBars.symbol, priceBars.date],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            currency: sql`excluded.currency`,
            sources: sql`excluded.sources`,
            bronzeIds: sql`excluded.bronze_ids`,
            observations: sql`excluded.observations`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        });
    }
    await rebuildGoldPrices(db, symbol, rows);
  }
  return { silverRowsBySource };
}

/** gold.price_bars for the dates just written (from those silver rows) + gold.quotes from the last two bars. */
export async function rebuildGoldPrices(db: Db, symbol: string, written: Row[]): Promise<void> {
  if (written.length === 0) return;
  const dates = written.map((r) => r.date);
  for (let i = 0; i < dates.length; i += BATCH) {
    await db.delete(gold.priceBars).where(and(eq(gold.priceBars.symbol, symbol), inArray(gold.priceBars.date, dates.slice(i, i + BATCH))));
  }
  const rows = written.map((b) => ({
    symbol,
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? null,
    sources: b.sources,
    alternatives: priceConsensus(b.observations).alternatives,
  }));
  for (let i = 0; i < rows.length; i += BATCH) await db.insert(gold.priceBars).values(rows.slice(i, i + BATCH));

  const [last, previous] = await db
    .select({ date: priceBars.date, close: priceBars.close, sources: priceBars.sources })
    .from(priceBars)
    .where(eq(priceBars.symbol, symbol))
    .orderBy(desc(priceBars.date))
    .limit(2);
  if (!last) return;
  // Not every price source states a currency (CNBC does not): take the one any bar of the ticker carries.
  const [withCurrency] = await db
    .select({ currency: priceBars.currency })
    .from(priceBars)
    .where(and(eq(priceBars.symbol, symbol), isNotNull(priceBars.currency)))
    .limit(1);
  const quote = {
    symbol,
    date: last.date,
    close: last.close,
    previousClose: previous?.close ?? null,
    change: previous ? last.close - previous.close : null,
    changePct: previous ? (last.close - previous.close) / previous.close : null,
    currency: withCurrency?.currency ?? null,
    sources: last.sources,
    rebuiltAt: new Date(),
  };
  await db.insert(gold.quotes).values(quote).onConflictDoUpdate({ target: gold.quotes.symbol, set: quote });
}
