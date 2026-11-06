import { doublePrecision, index, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { gold, type FieldProvenance } from "./gold";
import { marketEnum } from "./silver";

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Analyst consensus vs actual, one row per (ticker, fiscal period, metric): "KPIs vs market expectations".
 * Built from silver.facts (dimension "consensus"); `provenance` lists, per stat, every source behind the value.
 * low / mean / high / analysts come from ONE source (the one with the most analysts), never mixed across sources.
 */
export const consensus = gold.table(
  "consensus",
  {
    symbol: text("symbol").notNull(),
    /** "quarter" or "year" (fiscal). */
    periodType: text("period_type").$type<"quarter" | "year">().notNull(),
    /** Fiscal period end month, "YYYY-MM". */
    periodEnd: text("period_end").notNull(),
    /** revenue, ebitda, operating-income, net-income, eps. */
    metric: text("metric").notNull(),
    currency: text("currency"),
    low: doublePrecision("low"),
    mean: doublePrecision("mean"),
    high: doublePrecision("high"),
    analysts: integer("analysts"),
    /** Reported figure once the period is out (null before). */
    actual: doublePrecision("actual"),
    provenance: jsonb("provenance").$type<FieldProvenance>().notNull(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.periodType, t.periodEnd, t.metric] }), index("gold_consensus_symbol").on(t.symbol)],
);
export type GoldConsensus = typeof consensus.$inferSelect;

/**
 * Per (source, ticker), what the latest run got: "estimates" (an analyst consensus), "actuals" (reported figures
 * only), "empty" (answered, nothing), "failed", "not_covered" (the source does not answer this market).
 */
export const consensusCoverage = gold.table(
  "consensus_coverage",
  {
    source: text("source").notNull(),
    symbol: text("symbol").notNull(),
    market: marketEnum("market").notNull(),
    status: text("status").$type<"estimates" | "actuals" | "empty" | "failed" | "not_covered">().notNull(),
    /** Periods with a consensus in the latest answer. */
    estimatePeriods: integer("estimate_periods").notNull().default(0),
    /** Periods with a reported actual in the latest answer. */
    actualPeriods: integer("actual_periods").notNull().default(0),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    error: text("error"),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.source, t.symbol] })],
);
export type GoldConsensusCoverage = typeof consensusCoverage.$inferSelect;
