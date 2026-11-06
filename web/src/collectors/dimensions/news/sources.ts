import { eq } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { companyProfiles } from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { getJson, isUsSymbol } from "../../http";
import type { FetchOutcome, Source, SourceContext } from "../../types";
import {
  GOOGLE_REGION,
  googleQueries,
  parseDate,
  parseRss,
  type RawArticle,
  stripHtml,
  stripPublisherSuffix,
} from "./parse";

/** A news source = how to fetch one ticker + how to read articles out of its raw bronze answer. */
export type NewsSource = Source & {
  /** Throws when the answer cannot be read (never returns [] for a broken answer). */
  extract: (fetch: BronzeFetch) => Omit<RawArticle, "bronzeId">[];
};

const BROWSER_UA = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };
const LOOKBACK_DAYS = 7;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function getText(ctx: SourceContext, url: string, request: Record<string, unknown>): Promise<FetchOutcome> {
  const res = await ctx.fetch(url, { headers: BROWSER_UA });
  const text = await res.text();
  if (!res.ok) return { request, httpStatus: res.status, payloadText: text, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  try {
    parseRss(text);
  } catch (err) {
    return { request, httpStatus: res.status, payloadText: text, error: (err as Error).message };
  }
  return { request, httpStatus: res.status, payloadText: text };
}

/** Finnhub company news, last 7 days. Free tier: US listings only. Links are Finnhub redirects. */
export const finnhubNews: NewsSource = {
  name: "finnhub",
  requiredEnv: ["FINNHUB_API_KEY"],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_DAYS * 86400_000);
    const q = `symbol=${encodeURIComponent(symbol)}&from=${isoDay(from)}&to=${isoDay(to)}`;
    const out = await getJson(ctx, `https://finnhub.io/api/v1/company-news?${q}&token=${ctx.env.FINNHUB_API_KEY}`, {
      url: `https://finnhub.io/api/v1/company-news?${q}`,
    });
    if (!out.error && !Array.isArray(out.payload)) return { ...out, error: "Finnhub answer is not a list of articles" };
    return out;
  },
  extract(f) {
    return (f.payload as Record<string, unknown>[])
      .filter((a) => typeof a.url === "string" && typeof a.headline === "string" && a.headline.trim() !== "")
      .map((a) => ({
        source: "finnhub",
        symbol: f.subject,
        matchKind: "symbol" as const,
        matchedTerm: f.subject,
        title: (a.headline as string).trim(),
        url: a.url as string,
        publisher: (a.source as string) || null,
        summary: (a.summary as string)?.trim() || null,
        imageUrl: (a.image as string) || null,
        publishedAt: typeof a.datetime === "number" && a.datetime > 0 ? new Date(a.datetime * 1000) : null,
      }));
  },
};

/** Markets the Yahoo Finance RSS headline feed answers empty for, structurally (checked 2026-11-04). */
const YAHOO_UNCOVERED_SUFFIXES = [".T", ".HK", ".KS", ".KQ"];

/** Yahoo Finance headline RSS by symbol: no key, North America, UK, Europe, Australia. */
export const yahooNews: NewsSource = {
  name: "yahoo",
  requiredEnv: [],
  covers: (symbol) => !YAHOO_UNCOVERED_SUFFIXES.some((s) => symbol.toUpperCase().endsWith(s)),
  fetch(symbol, ctx) {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
    return getText(ctx, url, { url });
  },
  extract(f) {
    return parseRss(f.payloadText ?? "").map((i) => ({
      source: "yahoo",
      symbol: f.subject,
      matchKind: "symbol" as const,
      matchedTerm: f.subject,
      title: i.title,
      url: i.link,
      publisher: null,
      summary: i.description ? stripHtml(i.description) || null : null,
      imageUrl: null,
      publishedAt: parseDate(i.pubDate),
    }));
  },
};

type GoogleAnswer = { kind: "name" | "alias"; term: string; q: string; url: string; httpStatus: number; body: string };

/** What the Google source needs to build its queries: the resolved company name and Thierry's aliases. */
async function queryTerms(db: Db, symbol: string) {
  const [t] = await db.select().from(silver.tickers).where(eq(silver.tickers.symbol, symbol));
  if (!t) throw new Error(`${symbol} is not in the watchlist`);
  const [p] = await db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, symbol));
  if (!p?.name) throw new Error(`no company name for ${symbol} yet (company-profile has not resolved it), cannot query Google News`);
  return { market: t.market, name: p.name, aliases: t.aliases };
}

/**
 * Google News RSS by company name and each watchlist alias (every market, no key). One bronze row per ticker
 * holds every query's raw answer; one failed query fails the row.
 */
export const googleNews: NewsSource = {
  name: "google-news",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    if (!ctx.db) throw new Error("google-news needs the database to read names and aliases");
    const { market, name, aliases } = await queryTerms(ctx.db, symbol);
    const region = GOOGLE_REGION[market] ?? "US";
    const answers: GoogleAnswer[] = [];
    const errors: string[] = [];
    for (const query of googleQueries(symbol, name, aliases)) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query.q)}&hl=en-${region}&gl=${region}&ceid=${region}:en`;
      const res = await ctx.fetch(url, { headers: BROWSER_UA });
      const body = await res.text();
      answers.push({ ...query, url, httpStatus: res.status, body });
      if (!res.ok) errors.push(`${query.q}: HTTP ${res.status}`);
      else {
        try {
          parseRss(body);
        } catch (err) {
          errors.push(`${query.q}: ${(err as Error).message}`);
        }
      }
    }
    return {
      request: { queries: answers.map((a) => ({ q: a.q, url: a.url })) },
      httpStatus: answers.every((a) => a.httpStatus === 200) ? 200 : (answers.find((a) => a.httpStatus !== 200)?.httpStatus ?? null),
      payload: { answers },
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
  },
  extract(f) {
    const { answers } = f.payload as { answers: GoogleAnswer[] };
    return answers.flatMap((a) =>
      parseRss(a.body).map((i) => ({
        source: "google-news",
        symbol: f.subject,
        matchKind: a.kind,
        matchedTerm: a.term,
        title: stripPublisherSuffix(i.title, i.source),
        url: i.link,
        publisher: i.source,
        summary: null,
        imageUrl: null,
        publishedAt: parseDate(i.pubDate),
      })),
    );
  },
};

export const NEWS_SOURCES = [finnhubNews, googleNews, yahooNews] as const;
