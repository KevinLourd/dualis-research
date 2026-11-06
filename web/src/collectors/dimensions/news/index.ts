import { gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { newsItems, newsMentions } from "@/db/schema/news";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { rebuildGoldNews } from "./gold";
import { type ItemState, mergeArticles, type RawArticle } from "./parse";
import { NEWS_SOURCES } from "./sources";

export const NEWS_DIMENSION = "news";

/** Items older than this are not matched against new answers (sources only return the last week). */
const MATCH_HORIZON_MS = 60 * 86400_000;
const CHUNK = 200;

/**
 * News flow: Finnhub (US), Google News (name + aliases, every market), Yahoo Finance RSS (by symbol)
 * -> bronze.fetches -> silver.news_items + silver.news_mentions (one article, every source) -> gold feeds.
 * Runs after company-profile: Google News queries the resolved company name.
 */
export const news: Dimension = {
  name: NEWS_DIMENSION,
  description: "Articles about each ticker from Finnhub, Google News and Yahoo Finance, deduplicated across sources.",
  sources: NEWS_SOURCES,
  subjects: analysedSymbols,
  promote: promoteNews,
};

/** "source\0symbol" -> articles in that source's latest answer for that ticker. */
export type AnswerCounts = Map<string, number>;

export async function promoteNews(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const articles: RawArticle[] = [];
  const counts: AnswerCounts = new Map();
  for (const f of ok) {
    const source = NEWS_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`news: no extractor for source "${f.source}"`);
    const found = source.extract(f).map((a) => ({ ...a, bronzeId: f.id }));
    counts.set(`${f.source}\u0000${f.subject}`, found.length);
    articles.push(...found);
  }

  const since = new Date(Date.now() - MATCH_HORIZON_MS);
  const existing = await db
    .select()
    .from(newsItems)
    .where(or(isNull(newsItems.publishedAt), gte(newsItems.publishedAt, since), gte(newsItems.lastSeenAt, since)));
  const states: ItemState[] = existing.map((r) => ({ ...r, touched: false }));
  const { items, mentions } = mergeArticles(states, articles);
  const touched = items.filter((i) => i.touched);
  for (const i of touched) i.id ??= crypto.randomUUID();

  const now = new Date();
  await db.transaction(async (tx) => {
    for (let k = 0; k < touched.length; k += CHUNK) {
      const rows = touched.slice(k, k + CHUNK).map((i) => ({
        id: i.id!,
        title: i.title,
        titleKey: i.titleKey,
        url: i.url,
        urls: i.urls,
        urlKeys: i.urlKeys,
        publisher: i.publisher,
        summary: i.summary,
        imageUrl: i.imageUrl,
        publishedAt: i.publishedAt,
        sources: i.sources,
        bronzeIds: i.bronzeIds,
        firstSeenAt: now,
        lastSeenAt: now,
      }));
      await tx
        .insert(newsItems)
        .values(rows)
        .onConflictDoUpdate({
          target: newsItems.id,
          set: {
            url: sql`excluded.url`,
            urls: sql`excluded.urls`,
            urlKeys: sql`excluded.url_keys`,
            publisher: sql`excluded.publisher`,
            summary: sql`excluded.summary`,
            imageUrl: sql`excluded.image_url`,
            publishedAt: sql`excluded.published_at`,
            sources: sql`excluded.sources`,
            bronzeIds: sql`excluded.bronze_ids`,
            lastSeenAt: now,
          },
        });
    }

    // A mention seen before keeps its earlier sources: union with what this run saw.
    const ids = [...new Set(mentions.map((m) => m.item.id!))];
    const prior = new Map<string, { sources: string[]; bronzeIds: string[] }>();
    for (let k = 0; k < ids.length; k += CHUNK) {
      const rows = await tx.select().from(newsMentions).where(inArray(newsMentions.newsItemId, ids.slice(k, k + CHUNK)));
      for (const r of rows) prior.set(mentionKey(r.newsItemId, r.tickerSymbol, r.matchKind, r.matchedTerm), r);
    }
    const mentionRows = mentions.map((m) => {
      const p = prior.get(mentionKey(m.item.id!, m.symbol, m.matchKind, m.matchedTerm));
      const sources = [...(p?.sources ?? [])];
      const bronzeIds = [...(p?.bronzeIds ?? [])];
      m.sources.forEach((s, i) => {
        const j = sources.indexOf(s);
        if (j === -1) {
          sources.push(s);
          bronzeIds.push(m.bronzeIds[i]);
        } else bronzeIds[j] = m.bronzeIds[i];
      });
      return { newsItemId: m.item.id!, tickerSymbol: m.symbol, matchKind: m.matchKind, matchedTerm: m.matchedTerm, sources, bronzeIds };
    });
    for (let k = 0; k < mentionRows.length; k += CHUNK) {
      await tx
        .insert(newsMentions)
        .values(mentionRows.slice(k, k + CHUNK))
        .onConflictDoUpdate({
          target: [newsMentions.newsItemId, newsMentions.tickerSymbol, newsMentions.matchKind, newsMentions.matchedTerm],
          set: { sources: sql`excluded.sources`, bronzeIds: sql`excluded.bronze_ids` },
        });
    }
  });

  await rebuildGoldNews(db);

  // Silver articles each source answered with in this run (mentions carry only this run's sources).
  const bySource: Record<string, Set<string>> = {};
  for (const m of mentions) for (const s of m.sources) (bySource[s] ??= new Set()).add(m.item.id!);
  return { silverRowsBySource: Object.fromEntries(Object.entries(bySource).map(([s, ids]) => [s, ids.size])) };
}

function mentionKey(itemId: string, symbol: string, kind: string, term: string) {
  return `${itemId}\u0000${symbol}\u0000${kind}\u0000${term}`;
}
