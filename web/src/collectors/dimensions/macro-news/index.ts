import { and, desc, gte, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { canonicalUrl, parseDate, parseRss, stripPublisherSuffix } from "../news/parse";

/**
 * Macro / market headlines of the last 24 h (Kevin 2026-11-11, angle macro-24h of skill content-matrix): Google News RSS
 * searches, free and keyless. Bronze = each search's raw RSS; silver = one row per article (canonical link), every
 * search that found it; gold = the last 24 h, most searches first.
 */

export const MACRO_NEWS_DIMENSION = "macro-news";
export const GOOGLE_SOURCE = "google-news";
const WINDOW_MS = 24 * 3600_000;

/** The searches (subjects). `when:1d` = the last day only. */
export const MACRO_QUERIES = [
  "stock market today",
  "federal reserve interest rates",
  "inflation CPI",
  "treasury yields",
  "small cap stocks",
  "oil prices",
  "tariffs trade",
  "bank of japan yen",
  "south korea economy kospi",
  "china economy stimulus",
  "european central bank",
  "recession jobs report",
] as const;

const HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };

export const googleMacro: Source = {
  name: GOOGLE_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(query, ctx) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await ctx.fetch(url, { headers: HEADERS });
    const text = await res.text();
    const request = { url, query };
    if (!res.ok) return { request, httpStatus: res.status, payloadText: text, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    try {
      parseRss(text);
    } catch (err) {
      return { request, httpStatus: res.status, payloadText: text, error: (err as Error).message };
    }
    return { request, httpStatus: res.status, payloadText: text };
  },
};

export const macroNews: Dimension = {
  name: MACRO_NEWS_DIMENSION,
  description: "Macro and market headlines of the last 24 h (Google News searches), for the Sandbox's macro-24h angle.",
  sources: [googleMacro],
  subjects: async () => [...MACRO_QUERIES],
  promote: promoteMacroNews,
};

type Article = { urlKey: string; url: string; title: string; publisher: string | null; publishedAt: Date | null; query: string; bronzeId: string };

/** This run's RSS answers -> one silver row per article (queries and bronze ids merged) -> gold = the last 24 h. */
export async function promoteMacroNews(db: Db, fetches: BronzeFetch[], _ctx?: unknown, now = new Date()): Promise<PromoteResult> {
  const articles: Article[] = [];
  for (const f of fetches.filter((r) => r.source === GOOGLE_SOURCE && !r.error)) {
    for (const i of parseRss(f.payloadText ?? "")) {
      const publishedAt = parseDate(i.pubDate);
      if (publishedAt && now.getTime() - publishedAt.getTime() > WINDOW_MS) continue;
      articles.push({ urlKey: canonicalUrl(i.link), url: i.link, title: stripPublisherSuffix(i.title, i.source), publisher: i.source, publishedAt, query: f.subject, bronzeId: f.id });
    }
  }
  const byKey = new Map<string, Article[]>();
  for (const a of articles) byKey.set(a.urlKey, [...(byKey.get(a.urlKey) ?? []), a]);
  const keys = [...byKey.keys()];
  // Read back only the rows this run touches (egress rule).
  const existing = keys.length ? await db.select().from(sandbox.macroNewsItems).where(inArray(sandbox.macroNewsItems.urlKey, keys)) : [];
  const old = new Map(existing.map((e) => [e.urlKey, e]));
  for (const [urlKey, list] of byKey) {
    const e = old.get(urlKey);
    const queries = [...new Set([...(e?.queries ?? []), ...list.map((a) => a.query)])];
    const bronzeIds = [...new Set([...(e?.bronzeIds ?? []), ...list.map((a) => a.bronzeId)])].slice(-20);
    const row = { urlKey, url: list[0].url, title: list[0].title, publisher: list[0].publisher, publishedAt: list[0].publishedAt, queries, sources: [GOOGLE_SOURCE], bronzeIds, updatedAt: now };
    await db.insert(sandbox.macroNewsItems).values(row).onConflictDoUpdate({ target: sandbox.macroNewsItems.urlKey, set: row });
  }
  await rebuildGoldMacro(db, now);
  return { silverRowsBySource: { [GOOGLE_SOURCE]: byKey.size } };
}

/** gold.macro_news = silver articles published in the last 24 h. */
export async function rebuildGoldMacro(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_MS);
  const rows = await db
    .select()
    .from(sandbox.macroNewsItems)
    .where(and(gte(sandbox.macroNewsItems.publishedAt, since)))
    .orderBy(desc(sandbox.macroNewsItems.publishedAt));
  await db.delete(sandbox.goldMacroNews);
  if (rows.length === 0) return;
  await db.insert(sandbox.goldMacroNews).values(rows.map((r) => ({ id: r.id, url: r.url, title: r.title, publisher: r.publisher, publishedAt: r.publishedAt, queries: r.queries, sources: r.sources })));
}

/** The headline found by the most searches, newest first (the Sandbox's macro-24h input). */
export async function topMacroHeadline(db: Db): Promise<sandbox.GoldMacroNews | null> {
  const rows = await db.select().from(sandbox.goldMacroNews);
  return rows.sort((a, b) => b.queries.length - a.queries.length || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0] ?? null;
}
