import { doublePrecision, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { gold } from "./gold";

/**
 * Portfolio dimension: Thierry's positions (the tickers flagged `portfolio` in data/watchlist.json).
 * Silver = the generic silver.facts (dimension "portfolio"), tagged `substack` (what his published posts state,
 * each value with its cite) or `console` (what he typed on the Portfolio page: his word wins).
 * Gold = one row per position. The S&P 500 the page compares against is the price dimension's `^GSPC` series.
 */

export type PositionCite = { post: string; title: string; date: string; quote: string };
/** Per field: who stated the shown value, and the post sentence when a post did. */
export type PositionProvenance = Record<string, { sources: string[]; cite: PositionCite | null }>;

export const portfolioPositions = gold.table("portfolio_positions", {
  symbol: text("symbol").primaryKey(),
  /** "long" | "short"; null until a post or Thierry states it. */
  direction: text("direction").$type<"long" | "short">(),
  /** Day he entered, "YYYY-MM-DD". */
  entryDate: text("entry_date"),
  /** His entry price per share, in the quote currency. Never guessed: null until he types it. */
  entryPrice: doublePrecision("entry_price"),
  /** Share of the portfolio, 0 to 1. */
  weight: doublePrecision("weight"),
  /** "open" | "closed". */
  status: text("status").$type<"open" | "closed">(),
  /** The return a post published (ratio) and its date: shown while no entry price is known. */
  reportedReturn: doublePrecision("reported_return"),
  reportedReturnAsOf: text("reported_return_as_of"),
  provenance: jsonb("provenance").$type<PositionProvenance>().notNull(),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GoldPortfolioPosition = typeof portfolioPositions.$inferSelect;
