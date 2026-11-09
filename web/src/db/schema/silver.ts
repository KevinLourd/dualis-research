import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Silver: canonical, deduplicated rows built ONLY from bronze by a dimension's promoter.
 * Provenance rule: a fact several sources agree on carries EVERY source tag (`sources`), never first-found.
 */
export const silver = pgSchema("silver");

export const marketEnum = silver.enum("market", ["US", "CA", "JP", "KR", "UK", "HK", "AU", "EU"]);
export const positionEnum = silver.enum("position", ["long", "short", "watch"]);
export const authorEnum = silver.enum("author", ["thierry", "claude"]);
export const thesisStatusEnum = silver.enum("thesis_status", ["draft", "approved"]);

const lastRebuiltAt = timestamp("last_rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** One row per stock Thierry follows. Natural key: symbol (Yahoo-style suffix, e.g. 4238.T). */
export const tickers = silver.table("tickers", {
  symbol: text("symbol").primaryKey(),
  market: marketEnum("market").notNull(),
  aliases: text("aliases").array().notNull().default([]),
  inPortfolio: boolean("in_portfolio").notNull().default(false),
  /** In the analysis scope: heavy dimensions run on these only (`analysis_scope` in data/watchlist.json). */
  analysed: boolean("analysed").notNull().default(true),
  position: positionEnum("position").notNull().default("watch"),
  /** False once the symbol left the watchlist; rows are kept so history stays joinable. */
  active: boolean("active").notNull().default(true),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastRebuiltAt,
});

/**
 * Attribute facts about a subject, for every dimension whose output is "field = value" (company profile,
 * later market data snapshots...). One row per (dimension, subject, field, normalized value).
 * `sources` = every source CURRENTLY asserting that value; a source that changes its answer moves to the
 * new row, and a row nobody asserts any more is deleted (bronze keeps the history).
 */
export const facts = silver.table(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dimension: text("dimension").notNull(),
    subject: text("subject").notNull(),
    field: text("field").notNull(),
    value: jsonb("value").notNull(),
    /** Normalized comparison key: two sources agree when their keys are equal. */
    valueKey: text("value_key").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("facts_natural_key").on(t.dimension, t.subject, t.field, t.valueKey)],
);

export type SilverFact = typeof facts.$inferSelect;

/** The written view on a ticker: Thierry's, or prefilled by Claude for him to edit. */
export const theses = silver.table(
  "theses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tickerSymbol: text("ticker_symbol")
      .notNull()
      .references(() => tickers.symbol, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    killCriteria: text("kill_criteria"),
    author: authorEnum("author").notNull(),
    status: thesisStatusEnum("status").notNull().default("draft"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    lastRebuiltAt,
  },
  (t) => [uniqueIndex("theses_ticker_author").on(t.tickerSymbol, t.author)],
);

/**
 * An LLM judgment, made ONCE and stored (never recomputed on read).
 * Natural key: (subject_kind, subject_id, question_key).
 */
export const judgments = silver.table(
  "judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    questionKey: text("question_key").notNull(),
    question: text("question").notNull(),
    verdict: text("verdict").notNull(),
    probability: real("probability").notNull(),
    /** The sentence of the input that supports the verdict, verbatim. */
    citedSentence: text("cited_sentence"),
    /** One plain sentence saying why, for a reader who does not see the input. */
    reason: text("reason"),
    model: text("model").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("judgments_natural_key").on(t.subjectKind, t.subjectId, t.questionKey)],
);

/**
 * One 5-minute bar per (symbol, start time), Yahoo chart `interval=5m` (Kevin 2026-11-09: the live test and the judges
 * need the price at the minute a signal or a news item lands, not the day's close). `at` = the bar's START; its close
 * is known 5 minutes later (INTRADAY_MINUTES). `date` = the trading day in the exchange's own time zone, the same key as
 * the daily bars. A bar several sources give carries every tag; `observations` keeps each source's own bar.
 */
export const intradayBars = silver.table(
  "intraday_bars",
  {
    symbol: text("symbol").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    date: text("date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    currency: text("currency"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    observations: jsonb("observations").$type<Record<string, PriceObservation>>().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.at] })],
);

/**
 * One daily bar per (symbol, date). `observations` keeps every source's own bar; the chosen values are those of
 * the largest group of sources whose closes agree (within 0.5%), and `sources` lists every source in that group.
 */
export type PriceObservation = { open: number | null; high: number | null; low: number | null; close: number; volume: number | null; bronzeId: string };

export const priceBars = silver.table(
  "price_bars",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    currency: text("currency"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    observations: jsonb("observations").$type<Record<string, PriceObservation>>().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/**
 * A regulatory filing or exchange announcement. Natural key: (registry, filing_key), the registry's own id
 * (SEC accession number, TDnet id, EDINET docID, DART rcept_no...). A filing several sources list carries every tag.
 */
export const filings = silver.table(
  "filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    registry: text("registry").notNull(),
    filingKey: text("filing_key").notNull(),
    form: text("form"),
    title: text("title").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    url: text("url"),
    language: text("language").notNull().default("en"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("filings_natural_key").on(t.registry, t.filingKey), index("filings_symbol_filed").on(t.symbol, t.filedAt)],
);

