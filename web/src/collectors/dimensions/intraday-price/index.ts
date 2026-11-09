import { and, eq, inArray, max, min, ne, sql } from "drizzle-orm";
import { signalStates } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { intradayBars, type PriceObservation } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { BENCHMARK } from "../../benchmark";
import { getJson } from "../../http";
import { memo } from "../../markets";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { analysedSymbols } from "../watchlist";

export const INTRADAY_DIMENSION = "intraday-price";
/** Bar length. A bar's close is known INTRADAY_MINUTES after its start. */
export const INTRADAY_MINUTES = 5;
/** Yahoo serves 5-minute bars for the last 60 days only. */
const YAHOO_MAX_DAYS = 59;
/** A ticker with nothing stored yet: from a week before the first signal (a weekend signal trades at Friday's price). */
const LEAD_DAYS = 7;
/** Each run re-reads the last day already stored: Yahoo's last bar of a session is still moving when first fetched. */
const OVERLAP_MS = 86_400_000;
const BATCH = 500;
const DAY = 86_400_000;

export type IntradayBar = { at: Date; date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null };

type YahooChart = {
  meta: { currency?: string; gmtoffset?: number };
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
};

/** Yahoo answers 429 to browser-style headers and 200 to this plain client (same as the daily price source). */
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** First signal reading ever (any ticker), once per run: where a ticker with nothing stored starts. */
const firstSignalAt = (ctx: SourceContext) =>
  memo(ctx, "intraday-first-signal", async () => {
    const [row] = await ctx.db!.select({ at: min(signalStates.at) }).from(signalStates);
    return row?.at ?? null;
  });

/** The window to ask Yahoo for: from the last stored bar (minus a day), else a week before the first signal, never past 59 days. */
export async function fetchWindow(db: Db, symbol: string, first: Date | null, now: Date): Promise<{ from: Date; to: Date }> {
  const [row] = await db.select({ at: max(intradayBars.at) }).from(intradayBars).where(eq(intradayBars.symbol, symbol));
  const floor = now.getTime() - YAHOO_MAX_DAYS * DAY;
  const wanted = row?.at ? row.at.getTime() - OVERLAP_MS : first ? first.getTime() - LEAD_DAYS * DAY : now.getTime() - 5 * DAY;
  return { from: new Date(Math.max(floor, wanted)), to: now };
}

/** Yahoo chart, 5-minute bars, every market and the S&P 500, no key. A 429 is retried twice after a pause. */
export const yahooIntraday: Source & { extract: (payload: unknown) => { currency: string | null; bars: IntradayBar[] } } = {
  name: "yahoo",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const { from, to } = await fetchWindow(ctx.db!, symbol, await firstSignalAt(ctx), new Date());
    const p1 = Math.floor(from.getTime() / 1000);
    const p2 = Math.floor(to.getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=${INTRADAY_MINUTES}m`;
    const pauses = process.env.VITEST ? [] : [5_000, 20_000];
    if (!process.env.VITEST) await sleep(400);
    let out = await getJson(ctx, url, { url }, { headers: YAHOO_HEADERS });
    for (const pause of pauses) {
      if (out.httpStatus !== 429) break;
      await sleep(pause);
      out = await getJson(ctx, url, { url, retried: true }, { headers: YAHOO_HEADERS });
    }
    if (!out.error && !(out.payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0]) return { ...out, error: "Yahoo returned no intraday chart for this symbol" };
    return out;
  },
  extract(payload) {
    const r = (payload as { chart: { result: YahooChart[] } }).chart.result[0];
    const q = r.indicators?.quote?.[0] ?? {};
    const offset = r.meta.gmtoffset ?? 0;
    const bars: IntradayBar[] = [];
    (r.timestamp ?? []).forEach((ts, i) => {
      const close = q.close?.[i];
      if (close === null || close === undefined) return;
      bars.push({
        at: new Date(ts * 1000),
        // The trading day in the exchange's own time zone, the daily bars' key.
        date: new Date((ts + offset) * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
        close,
        volume: q.volume?.[i] ?? null,
      });
    });
    return { currency: r.meta.currency ?? null, bars };
  },
};

export const INTRADAY_SOURCES = [yahooIntraday] as const;

/** Every analysed ticker, every ticker that ever had a BUY or SELL (its live-test positions), and the S&P 500. */
async function intradaySubjects(db: Db): Promise<string[]> {
  const traded = await db.selectDistinct({ symbol: signalStates.symbol }).from(signalStates).where(ne(signalStates.signal, "none"));
  return [...new Set([...(await analysedSymbols(db)), ...traded.map((t) => t.symbol)])].sort().concat(BENCHMARK);
}

export const intradayPrice: Dimension = {
  name: INTRADAY_DIMENSION,
  description: "5-minute prices (Yahoo, last 60 days at most) of the analysed and traded tickers and the S&P 500: the price at the minute a signal or a news item lands.",
  sources: INTRADAY_SOURCES,
  subjects: intradaySubjects,
  promote: promoteIntraday,
};

/**
 * bronze -> silver.intraday_bars -> gold.intraday_bars. A run writes only the bars its fetches returned (upsert on
 * symbol x start time) and reads nothing back but the observations of those same bars (Neon egress rule).
 */
export async function promoteIntraday(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const silverRowsBySource: Record<string, number> = {};
  for (const symbol of [...new Set(ok.map((f) => f.subject))]) {
    const byAt = new Map<number, { bar: IntradayBar; currency: string | null; observations: Record<string, PriceObservation> }>();
    for (const f of ok.filter((x) => x.subject === symbol)) {
      const source = INTRADAY_SOURCES.find((s) => s.name === f.source);
      if (!source) throw new Error(`intraday-price: no extractor for source "${f.source}"`);
      const { currency, bars } = source.extract(f.payload ?? f.payloadText);
      for (const bar of bars) {
        silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + 1;
        const cur = byAt.get(bar.at.getTime()) ?? { bar, currency, observations: {} };
        cur.observations[f.source] = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, bronzeId: f.id };
        // The latest fetch's bar wins: a session's last bar moves until the session ends.
        cur.bar = bar;
        cur.currency ??= currency;
        byAt.set(bar.at.getTime(), cur);
      }
    }
    if (!byAt.size) continue;
    const ats = [...byAt.values()].map((v) => v.bar.at);
    // Keep the other sources' observations already stored for these bars (one source today; the rule holds for more).
    const stored = new Map<number, Record<string, PriceObservation>>();
    for (let i = 0; i < ats.length; i += BATCH) {
      const rows = await db
        .select({ at: intradayBars.at, observations: intradayBars.observations })
        .from(intradayBars)
        .where(and(eq(intradayBars.symbol, symbol), inArray(intradayBars.at, ats.slice(i, i + BATCH))));
      for (const r of rows) stored.set(r.at.getTime(), r.observations);
    }
    const rows = [...byAt.values()].map(({ bar, currency, observations }) => {
      const all = { ...(stored.get(bar.at.getTime()) ?? {}), ...observations };
      const sources = Object.keys(all).sort();
      return {
        symbol,
        at: bar.at,
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        currency,
        sources,
        bronzeIds: sources.map((s) => all[s].bronzeId),
        observations: all,
        lastSeenAt: new Date(),
      };
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      await db
        .insert(intradayBars)
        .values(chunk)
        .onConflictDoUpdate({
          target: [intradayBars.symbol, intradayBars.at],
          set: {
            date: sql`excluded.date`,
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
      await db
        .insert(gold.intradayBars)
        .values(chunk.map((r) => ({ symbol, at: r.at, date: r.date, close: r.close, sources: r.sources })))
        .onConflictDoUpdate({ target: [gold.intradayBars.symbol, gold.intradayBars.at], set: { date: sql`excluded.date`, close: sql`excluded.close`, sources: sql`excluded.sources` } });
    }
  }
  return { silverRowsBySource };
}
