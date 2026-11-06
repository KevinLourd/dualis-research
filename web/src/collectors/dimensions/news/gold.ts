import { eq, inArray, sql } from "drizzle-orm";
import { goldNewsItems, goldNewsLinks, type NewsMatch, newsItems, newsMentions } from "@/db/schema/news";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";

const CHUNK = 200;

/**
 * Rebuilds the gold news tables from silver: the global feed (articles tied to an active ticker), the per-ticker
 * links with how each match was made.
 */
export async function rebuildGoldNews(db: Db): Promise<void> {
  const active = await db
    .select({ symbol: silver.tickers.symbol, market: silver.tickers.market })
    .from(silver.tickers)
    .where(sql`${silver.tickers.active}`);
  const marketOf = new Map(active.map((t) => [t.symbol, t.market]));
  const symbols = [...marketOf.keys()];

  const rows =
    symbols.length === 0
      ? []
      : await db
          .select({ mention: newsMentions, item: newsItems })
          .from(newsMentions)
          .innerJoin(newsItems, eq(newsItems.id, newsMentions.newsItemId))
          .where(inArray(newsMentions.tickerSymbol, symbols));

  type Link = typeof goldNewsLinks.$inferInsert;
  const items = new Map<string, typeof goldNewsItems.$inferInsert & { symbols: string[]; markets: string[] }>();
  const links = new Map<string, Link & { matchKinds: string[]; matchedTerms: string[]; sources: string[]; matches: NewsMatch[] }>();
  for (const { mention: m, item: i } of rows) {
    const market = marketOf.get(m.tickerSymbol)!;
    const it = items.get(i.id) ?? {
      id: i.id,
      title: i.title,
      url: i.url,
      publisher: i.publisher,
      summary: i.summary,
      imageUrl: i.imageUrl,
      publishedAt: i.publishedAt,
      firstSeenAt: i.firstSeenAt,
      sources: i.sources,
      symbols: [],
      markets: [],
    };
    if (!it.symbols.includes(m.tickerSymbol)) it.symbols.push(m.tickerSymbol);
    if (!it.markets.includes(market)) it.markets.push(market);
    items.set(i.id, it);

    const key = `${i.id}\u0000${m.tickerSymbol}`;
    const l = links.get(key) ?? {
      newsItemId: i.id,
      symbol: m.tickerSymbol,
      market,
      publishedAt: i.publishedAt,
      firstSeenAt: i.firstSeenAt,
      matchKinds: [],
      matchedTerms: [],
      sources: [],
      matches: [],
    };
    if (!l.matchKinds.includes(m.matchKind)) l.matchKinds.push(m.matchKind);
    if (!l.matchedTerms.includes(m.matchedTerm)) l.matchedTerms.push(m.matchedTerm);
    for (const s of m.sources) if (!l.sources.includes(s)) l.sources.push(s);
    l.matches.push({ kind: m.matchKind, term: m.matchedTerm, sources: m.sources });
    links.set(key, l);
  }
  for (const it of items.values()) it.symbols.sort();

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(goldNewsLinks);
    await tx.delete(goldNewsItems);
    const itemRows = [...items.values()].map((i) => ({ ...i, rebuiltAt: now }));
    for (let k = 0; k < itemRows.length; k += CHUNK) await tx.insert(goldNewsItems).values(itemRows.slice(k, k + CHUNK));
    const linkRows = [...links.values()].map((l) => ({ ...l, rebuiltAt: now }));
    for (let k = 0; k < linkRows.length; k += CHUNK) await tx.insert(goldNewsLinks).values(linkRows.slice(k, k + CHUNK));
  });
}
