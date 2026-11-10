import { boolean, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { marketEnum, positionEnum } from "./silver";

/**
 * Gold: what the console reads. Rebuilt from silver by the dimension's promoter, never written from an API.
 * The console never reads bronze or silver directly.
 */
export const gold = pgSchema("gold");

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Watchlist as the console shows it (active tickers only). */
export const tickers = gold.table("tickers", {
  symbol: text("symbol").primaryKey(),
  market: marketEnum("market").notNull(),
  aliases: text("aliases").array().notNull(),
  inPortfolio: boolean("in_portfolio").notNull(),
  /** In the analysis scope (Signals table); false = the Inactive tab, nothing analysed. */
  analysed: boolean("analysed").notNull().default(true),
  position: positionEnum("position").notNull(),
  /** Thierry's own thesis note, when he wrote one. */
  thesisNote: text("thesis_note"),
  rebuiltAt,
});

/** Per field: the sources behind the chosen value, and how many other values sources disagree with. */
export type FieldProvenance = Record<string, { sources: string[]; alternatives: number }>;

/** One resolved profile per ticker; every field picked from silver.facts by `pickWinner`. */
export const companyProfiles = gold.table("company_profiles", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  exchange: text("exchange"),
  currency: text("currency"),
  country: text("country"),
  sector: text("sector"),
  industry: text("industry"),
  description: text("description"),
  website: text("website"),
  logoUrl: text("logo_url"),
  marketCap: doublePrecision("market_cap"),
  employees: integer("employees"),
  ipoDate: text("ipo_date"),
  provenance: jsonb("provenance").$type<FieldProvenance>().notNull(),
  rebuiltAt,
});

export type GoldCompanyProfile = typeof companyProfiles.$inferSelect;

/** Daily bars the Price chart reads, one per (symbol, date), with the sources that agree on the close. */
export const priceBars = gold.table(
  "price_bars",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    sources: text("sources").array().notNull(),
    /** Other sources' closes on that day when they disagree (more than 0.5% apart). */
    alternatives: jsonb("alternatives").$type<{ source: string; close: number }[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/** 5-minute bars (silver.intraday_bars' chosen close): the price at the minute a signal or a news item lands. */
export const intradayBars = gold.table(
  "intraday_bars",
  {
    symbol: text("symbol").notNull(),
    /** The bar's start; its close is known INTRADAY_MINUTES later. */
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** Trading day in the exchange's time zone (same key as price_bars.date). */
    date: text("date").notNull(),
    close: doublePrecision("close").notNull(),
    sources: text("sources").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.at] })],
);

/**
 * Latest price and day change per ticker (Tickers list, ticker header, every judge's « price today »). `price` writes
 * the last daily close (`source` close); `intraday-price` then moves it to the latest 5-minute price (`source`
 * intraday, `at` = when that price was known; Kevin 2026-11-09: the LLMs read the real price, not yesterday's close).
 */
export const quotes = gold.table("quotes", {
  symbol: text("symbol").primaryKey(),
  date: text("date").notNull(),
  close: doublePrecision("close").notNull(),
  /** When that price was known (5-minute prices only; a daily close carries its date). */
  at: timestamp("at", { withTimezone: true }),
  source: text("source").$type<"intraday" | "close">().notNull().default("close"),
  previousClose: doublePrecision("previous_close"),
  change: doublePrecision("change"),
  changePct: doublePrecision("change_pct"),
  currency: text("currency"),
  sources: text("sources").array().notNull(),
  rebuiltAt,
});

/** Filings and announcements per ticker, newest first. Read by the Filings tab and the Catalysts timeline. */
export const filings = gold.table(
  "filings",
  {
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    registry: text("registry").notNull(),
    filingKey: text("filing_key").notNull(),
    form: text("form"),
    title: text("title").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    url: text("url"),
    language: text("language").notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_filings_symbol_filed").on(t.symbol, t.filedAt)],
);

/**
 * One row per (symbol, fiscal period end month): report date, EPS and revenue, estimate vs actual.
 * Every value picked from silver.facts (dimension "earnings") with its sources in `provenance`.
 */
export const earnings = gold.table(
  "earnings",
  {
    symbol: text("symbol").notNull(),
    /** Fiscal quarter end, "YYYY-MM". */
    period: text("period").notNull(),
    reportDate: text("report_date"),
    /** "bmo" before market open, "amc" after market close, "dmh" during market hours. */
    hour: text("hour"),
    epsActual: doublePrecision("eps_actual"),
    epsEstimate: doublePrecision("eps_estimate"),
    revenueActual: doublePrecision("revenue_actual"),
    revenueEstimate: doublePrecision("revenue_estimate"),
    provenance: jsonb("provenance").$type<FieldProvenance>().notNull(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.period] })],
);

/** Daily exchange rates as the collectors read them (from silver.fx_rates): a fair value in CAD shown against a USD quote. */
export const fxRates = gold.table(
  "fx_rates",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    date: text("date").notNull(),
    rate: doublePrecision("rate").notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.date] })],
);
export type GoldFxRate = typeof fxRates.$inferSelect;
