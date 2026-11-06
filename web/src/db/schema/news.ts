import {
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { marketEnum, silver, tickers } from "./silver";

/**
 * News dimension. Bronze = every raw feed answer (bronze.fetches, dimension "news").
 * Silver = one row per article, deduplicated across sources (canonical URL or near-identical title), every source
 * tag kept, plus one row per (article, ticker, how it matched). Gold = what the News pages read.
 */

/** How an article was tied to a ticker: the vendor's symbol feed, the company name query, or a watchlist alias. */
export const newsMatchKindEnum = silver.enum("news_match_kind", ["symbol", "name", "alias"]);

/** One article. `sources[i]` was last read from `bronzeIds[i]`. */
export const newsItems = silver.table(
  "news_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /** Normalized title (case, punctuation, publisher suffix removed): near-identical titles share it. */
    titleKey: text("title_key").notNull(),
    /** Best link to show (the publisher's own URL when a source gave one, else an aggregator link). */
    url: text("url").notNull(),
    /** Every link any source gave for this article. */
    urls: text("urls").array().notNull(),
    /** Canonical form of each link (no scheme, www, tracking params, fragment, trailing slash). */
    urlKeys: text("url_keys").array().notNull(),
    publisher: text("publisher"),
    summary: text("summary"),
    imageUrl: text("image_url"),
    /** Earliest publication time any source reported; null when no source dated it. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("news_items_title_key").on(t.titleKey), index("news_items_published").on(t.publishedAt)],
);
export type SilverNewsItem = typeof newsItems.$inferSelect;

/**
 * Why an article is tied to a ticker. One row per (article, ticker, match kind, matched term): a noisy alias shows
 * up as its own rows and can be fixed in the watchlist.
 */
export const newsMentions = silver.table(
  "news_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => newsItems.id, { onDelete: "cascade" }),
    tickerSymbol: text("ticker_symbol")
      .notNull()
      .references(() => tickers.symbol, { onDelete: "cascade" }),
    matchKind: newsMatchKindEnum("match_kind").notNull(),
    /** The query term: the symbol, the cleaned company name, or the alias. */
    matchedTerm: text("matched_term").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("news_mentions_natural_key").on(t.newsItemId, t.tickerSymbol, t.matchKind, t.matchedTerm),
    index("news_mentions_ticker").on(t.tickerSymbol),
  ],
);

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Global feed: one row per article tied to at least one active ticker. Same id as silver. */
export const goldNewsItems = gold.table(
  "news_items",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publisher: text("publisher"),
    summary: text("summary"),
    imageUrl: text("image_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** When we first collected it: drives "new since your last visit". */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    sources: text("sources").array().notNull(),
    symbols: text("symbols").array().notNull(),
    markets: text("markets").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_news_items_published").on(t.publishedAt)],
);
export type GoldNewsItem = typeof goldNewsItems.$inferSelect;

export type NewsMatch = { kind: "symbol" | "name" | "alias"; term: string; sources: string[] };

/** Per-ticker feed: one row per (article, ticker), with how the match was made. Catalysts read this. */
export const goldNewsLinks = gold.table(
  "news_links",
  {
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => goldNewsItems.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    market: marketEnum("market").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    /** e.g. ["name", "alias"] */
    matchKinds: text("match_kinds").array().notNull(),
    /** Distinct query terms that matched, e.g. ["Conrad Shipyard"]. */
    matchedTerms: text("matched_terms").array().notNull(),
    /** Sources that tied this article to this ticker. */
    sources: text("sources").array().notNull(),
    /** Each match with the sources behind it: which query term pulled this article in, and who answered it. */
    matches: jsonb("matches").$type<NewsMatch[]>().notNull(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.newsItemId, t.symbol] }), index("gold_news_links_symbol").on(t.symbol, t.publishedAt)],
);
export type GoldNewsLink = typeof goldNewsLinks.$inferSelect;
