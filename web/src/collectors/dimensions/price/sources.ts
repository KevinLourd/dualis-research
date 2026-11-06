import type { Source } from "../../types";
import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, daysAgo, isMarket, isoDate, memo, suffixOf, tickerBase } from "../../markets";
import { parseNumber } from "../company-profile/sources";

/** An index (Yahoo spelling, "^GSPC"): only Yahoo serves it. */
export const isIndex = (symbol: string) => symbol.startsWith("^");

export type Bar = { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null };

/** A price source = how to fetch a year of daily bars + how to read them out of the raw answer. */
export type PriceSource = Source & {
  extract: (payload: unknown) => { currency: string | null; bars: Bar[] };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Yahoo chart: five years of daily bars (the price vs fair value chart's 5Y view), every market, no key. Yahoo rate-limits bursts (HTTP 429), so calls are
 * spaced and a 429 is retried twice after a pause; a third 429 lands in bronze as a failed fetch.
 */
/** Yahoo answers 429 to browser-style headers (Accept: application/json...) and 200 to this plain client. */
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };

export const yahoo: PriceSource = {
  name: "yahoo",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
    // Once Yahoo has refused three symbols in a row it is blocking this machine: stop waiting on it for this run.
    const refusals = await memo(ctx, "yahoo-refusals", async () => ({ inARow: 0 }));
    const pauses = process.env.VITEST || refusals.inARow >= 3 ? [] : [5_000, 20_000];
    if (!process.env.VITEST) await sleep(400);
    let out = await getJson(ctx, url, { url }, { headers: YAHOO_HEADERS });
    for (const pause of pauses) {
      if (out.httpStatus !== 429) break;
      await sleep(pause);
      out = await getJson(ctx, url, { url, retried: true }, { headers: YAHOO_HEADERS });
    }
    refusals.inARow = out.httpStatus === 429 ? refusals.inARow + 1 : 0;
    if (!out.error && !(out.payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0]) {
      return { ...out, error: "Yahoo returned no chart for this symbol" };
    }
    return out;
  },
  extract(payload) {
    const r = (payload as { chart: { result: YahooChart[] } }).chart.result[0];
    const q = r.indicators?.quote?.[0] ?? {};
    const offset = r.meta.gmtoffset ?? 0;
    const bars: Bar[] = [];
    (r.timestamp ?? []).forEach((ts, i) => {
      const close = q.close?.[i];
      if (close === null || close === undefined) return;
      bars.push({
        // The trading day in the exchange's own time zone.
        date: isoDate(new Date((ts + offset) * 1000)),
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

type YahooChart = {
  meta: { currency?: string; gmtoffset?: number };
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
};

/** "11/03/2026" -> "2026-11-03". */
export const usDate = (v: string) => {
  const [m, d, y] = v.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

/** Nasdaq historical quotes: one year of daily bars for US listings, no key. */
export const nasdaq: PriceSource = {
  name: "nasdaq",
  requiredEnv: [],
  covers: (symbol) => isUsSymbol(symbol) && !isIndex(symbol),
  async fetch(symbol, ctx) {
    const from = isoDate(daysAgo(366));
    const to = isoDate(new Date());
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=400`;
    const out = await getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
    const rows = (out.payload as { data?: { tradesTable?: { rows?: unknown[] } } })?.data?.tradesTable?.rows;
    if (!out.error && !rows?.length) return { ...out, error: "Nasdaq has no price history for this symbol" };
    return out;
  },
  extract(payload) {
    const rows = (payload as { data: { tradesTable: { rows: Record<string, string>[] } } }).data.tradesTable.rows;
    return {
      currency: "USD",
      bars: rows
        .map((r) => ({
          date: usDate(r.date),
          open: parseNumber(r.open),
          high: parseNumber(r.high),
          low: parseNumber(r.low),
          close: parseNumber(r.close) as number,
          volume: parseNumber(r.volume),
        }))
        .filter((b) => b.close !== null),
    };
  },
};

/** CNBC's country code per exchange suffix; US listings go bare. LSE and CSE symbols are not on CNBC's chart API. */
const CNBC_SUFFIX: Record<string, string> = { T: "JP", HK: "HK", KS: "KR", KQ: "KR", AX: "AU", PA: "FR", DE: "DE", TO: "CA", V: "V" };
export const cnbcSymbol = (symbol: string): string | null => {
  const suffix = suffixOf(symbol);
  if (!suffix) return symbol;
  const country = CNBC_SUFFIX[suffix];
  return country ? `${tickerBase(symbol)}-${country}` : null;
};
/** CNBC marks a missing value with a large negative sentinel ("-9999401.0000"). */
const price = (v: unknown) => {
  const n = parseNumber(v);
  return n !== null && n >= 0 ? n : null;
};

/** CNBC chart bars (the data behind cnbc.com quote pages): about two years of daily bars, most markets. No key. */
export const cnbc: PriceSource = {
  name: "cnbc",
  requiredEnv: [],
  covers: (symbol) => !isIndex(symbol) && cnbcSymbol(symbol) !== null,
  async fetch(symbol, ctx) {
    const url = `https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=${encodeURIComponent(cnbcSymbol(symbol)!)}`;
    let out = await getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
    // CNBC's edge answers a passing 503 ("Backend fetch failed"); one retry after a pause clears it.
    if (out.httpStatus !== null && out.httpStatus >= 500) {
      if (!process.env.VITEST) await sleep(3_000);
      out = await getJson(ctx, url, { url, retried: true }, { headers: BROWSER_HEADERS });
    }
    const p = out.payload as { barData?: { priceBars?: unknown[] }; statusMessage?: string };
    if (!out.error && !p?.barData?.priceBars?.length) return { ...out, error: p?.statusMessage ?? "CNBC returned no bars" };
    return out;
  },
  extract(payload) {
    const rows = (payload as { barData: { priceBars: Record<string, string | number>[] } }).barData.priceBars;
    const bars: Bar[] = [];
    for (const r of rows) {
      const close = price(r.close);
      if (close === null) continue;
      const t = String(r.tradeTime);
      bars.push({ date: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`, open: price(r.open), high: price(r.high), low: price(r.low), close, volume: parseNumber(r.volume) });
    }
    return { currency: null, bars };
  },
};

/** Naver Finance daily prices (Korea's largest portal, KRX data): one year, KOSPI and KOSDAQ. No key. */
export const naver: PriceSource = {
  name: "naver",
  requiredEnv: [],
  covers: (symbol) => !isIndex(symbol) && isMarket("KR")(symbol),
  async fetch(symbol, ctx) {
    const range = `startTime=${isoDate(daysAgo(366)).replace(/-/g, "")}&endTime=${isoDate(new Date()).replace(/-/g, "")}`;
    const url = `https://api.finance.naver.com/siseJson.naver?symbol=${tickerBase(symbol)}&requestType=1&${range}&timeframe=day`;
    const res = await ctx.fetch(url, { headers: BROWSER_HEADERS });
    const text = await res.text();
    const base = { request: { url }, httpStatus: res.status, payloadText: text };
    if (!res.ok) return { ...base, error: `HTTP ${res.status}` };
    // The answer is a JavaScript array literal (single-quoted header row), not JSON.
    const rows = JSON.parse(text.replace(/'/g, '"')) as unknown[][];
    if (rows.length < 2) return { ...base, error: "Naver returned no prices for this symbol" };
    return base;
  },
  extract(payload) {
    const rows = (JSON.parse(String(payload).replace(/'/g, '"')) as (string | number)[][]).slice(1);
    return {
      currency: "KRW",
      bars: rows.map(([d, open, high, low, close, volume]) => {
        const t = String(d);
        return { date: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) };
      }),
    };
  },
};

export const PRICE_SOURCES = [nasdaq, naver, cnbc, yahoo] as const;
