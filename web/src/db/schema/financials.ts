import { boolean, doublePrecision, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Financial statements, 5 years, as published (dimension `financials`).
 * A period = (period_type, period_end): "year" (fiscal year), "half" (6 months, an interim report) or "quarter"
 * (3 months), end = fiscal period end month
 * "YYYY-MM"; "month" carries the month-end share price only (statement "market").
 * Values are in full currency units (KRW, not KRW million), per share for EPS and prices, a count for shares.
 * Outflows (capex, dividends paid, buybacks) are stored POSITIVE.
 */

/** What one source said about one line: kept per source so a later answer replaces only its own. */
export type LineObservation = {
  value: number;
  currency: string | null;
  /** The source's own label, as published ("매출액", "NetSalesSummaryOfBusinessResults", "Revenue"). */
  label: string;
  consolidated: boolean | null;
  bronzeId: string;
  /** Extraction from a document (source `pdf-extract`): which document and page the value was read on. */
  citation?: { document: string; url: string; page: number; quote?: string } | null;
};

/**
 * One canonical line per (ticker, period, line), every source's observation kept. `sources` = the group of sources
 * whose values agree (within 0.5%), the one gold shows; the others are alternatives. Natural key: the primary key.
 */
export const financialLines = silver.table(
  "financial_lines",
  {
    symbol: text("symbol").notNull(),
    periodType: text("period_type").$type<"year" | "half" | "quarter" | "month">().notNull(),
    periodEnd: text("period_end").notNull(),
    /** Canonical line key (`lines.ts`): revenue, operating-income, cash... or `segment:<axis>:<name>`. */
    line: text("line").notNull(),
    statement: text("statement").$type<"income" | "balance" | "cashflow" | "market" | "segment">().notNull(),
    value: doublePrecision("value").notNull(),
    currency: text("currency"),
    label: text("label").notNull(),
    consolidated: boolean("consolidated"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    observations: jsonb("observations").$type<Record<string, LineObservation>>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastRebuiltAt: timestamp("last_rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.periodType, t.periodEnd, t.line] })],
);
export type SilverFinancialLine = typeof financialLines.$inferSelect;

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** The financial line the console and the analysis read: silver's chosen value + the disagreeing ones. */
export const goldFinancialLines = gold.table(
  "financial_lines",
  {
    symbol: text("symbol").notNull(),
    periodType: text("period_type").$type<"year" | "half" | "quarter" | "month">().notNull(),
    periodEnd: text("period_end").notNull(),
    line: text("line").notNull(),
    statement: text("statement").$type<"income" | "balance" | "cashflow" | "market" | "segment">().notNull(),
    value: doublePrecision("value").notNull(),
    currency: text("currency"),
    label: text("label").notNull(),
    consolidated: boolean("consolidated"),
    /** Every source agreeing on `value`. `pdf-extract` = read by Claude from the annual report PDF, never "published" data. */
    sources: text("sources").array().notNull(),
    /** Sources that published another value for the same line. */
    alternatives: jsonb("alternatives").$type<{ source: string; value: number }[]>().notNull(),
    citation: jsonb("citation").$type<LineObservation["citation"]>(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.periodType, t.periodEnd, t.line] }), index("gold_financial_lines_symbol").on(t.symbol)],
);
export type GoldFinancialLine = typeof goldFinancialLines.$inferSelect;

/**
 * Metrics computed deterministically from gold.financial_lines (`derive.ts`), one row per (ticker, period, metric):
 * ebitda, fcf, net-debt, margins, growth, market-cap, ev, ev-ebitda. `formula` says how, `inputs` which lines.
 * Ratios are fractions (0.23 = 23%), multiples are plain numbers (8.4 = 8.4x).
 */
export const financialMetrics = gold.table(
  "financial_metrics",
  {
    symbol: text("symbol").notNull(),
    periodType: text("period_type").$type<"year" | "quarter">().notNull(),
    periodEnd: text("period_end").notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    /** "currency" (amount in `currency`), "ratio", "multiple", "per-share". */
    unit: text("unit").$type<"currency" | "ratio" | "multiple" | "per-share">().notNull(),
    currency: text("currency"),
    formula: text("formula").notNull(),
    inputs: jsonb("inputs").$type<{ line: string; periodEnd: string; value: number }[]>().notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.periodType, t.periodEnd, t.metric] }), index("gold_financial_metrics_symbol").on(t.symbol)],
);
export type GoldFinancialMetric = typeof financialMetrics.$inferSelect;

/**
 * Revenue per stream (`streams.ts`), rebuilt from gold.financial_lines each run: one row per (ticker, stream, period).
 * A stream = one business line on one axis (`segment:<axis>:<name>`: product, business, region, customer) or the
 * total (`revenue`). Each row says how the stream moved against the same period a year earlier, its share of total
 * revenue, and its last 12 months when an interim period follows the last fiscal year. Data only: the analysis reads
 * these rows and judges what they mean.
 */
export const revenueStreams = gold.table(
  "revenue_streams",
  {
    symbol: text("symbol").notNull(),
    /** "revenue" for the total, else the segment line key. */
    line: text("line").notNull(),
    /** "total", "product", "business", "region", "customer". */
    axis: text("axis").notNull(),
    name: text("name").notNull(),
    periodType: text("period_type").$type<"year" | "half" | "quarter">().notNull(),
    periodEnd: text("period_end").notNull(),
    value: doublePrecision("value").notNull(),
    currency: text("currency"),
    /** Same stream, same period length, one year earlier; growth = value / prior - 1 (null when prior <= 0). */
    priorValue: doublePrecision("prior_value"),
    growth: doublePrecision("growth"),
    /** Stream / total revenue of the same period (null for the total or when the total is missing). */
    shareOfTotal: doublePrecision("share_of_total"),
    /** Sum of the axis' streams / total revenue of that period: 1 = the streams add up to the total. */
    axisCoverage: doublePrecision("axis_coverage"),
    /** Last 12 months ending at this period end: last fiscal year + interim periods since - the same periods a year earlier. */
    ltmValue: doublePrecision("ltm_value"),
    ltmPrior: doublePrecision("ltm_prior"),
    ltmGrowth: doublePrecision("ltm_growth"),
    ltmFormula: text("ltm_formula"),
    sources: text("sources").array().notNull(),
    citation: jsonb("citation").$type<LineObservation["citation"]>(),
    rebuiltAt,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.line, t.periodType, t.periodEnd] }), index("gold_revenue_streams_symbol").on(t.symbol)],
);
export type GoldRevenueStream = typeof revenueStreams.$inferSelect;

/**
 * One row per ticker: the valuation inputs a fair value needs. EV/EBITDA history over the last 5 fiscal years
 * (each year at its fiscal year-end price), and today's EV/EBITDA on the latest quote, latest balance sheet and the
 * last fiscal year's EBITDA (or the last 4 reported quarters when they exist).
 */
export const valuations = gold.table("valuations", {
  symbol: text("symbol").primaryKey(),
  /** Reporting currency of the statements. */
  currency: text("currency"),
  /** Quote currency; null when it differs from the reporting currency (no EV is computed then). */
  quoteCurrency: text("quote_currency"),
  /** Last fiscal year end, "YYYY-MM". */
  lastFiscalYear: text("last_fiscal_year"),
  /** Fiscal years with revenue. */
  yearsCovered: integer("years_covered").notNull(),
  evEbitdaLow: doublePrecision("ev_ebitda_low"),
  evEbitdaMedian: doublePrecision("ev_ebitda_median"),
  evEbitdaHigh: doublePrecision("ev_ebitda_high"),
  /** Fiscal years behind the range. */
  evEbitdaYears: text("ev_ebitda_years").array().notNull(),
  quoteDate: text("quote_date"),
  quote: doublePrecision("quote"),
  sharesOutstanding: doublePrecision("shares_outstanding"),
  /** Total debt - cash; `ev` uses the full bridge (`BRIDGE_LINES` in financials/derive.ts), each line in `inputs`. */
  netDebt: doublePrecision("net_debt"),
  /** EBITDA the current multiple uses, and which periods it sums ("FY 2025-12" or "LTM to 2026-09"). */
  ebitda: doublePrecision("ebitda"),
  ebitdaBasis: text("ebitda_basis"),
  marketCap: doublePrecision("market_cap"),
  ev: doublePrecision("ev"),
  evEbitda: doublePrecision("ev_ebitda"),
  /** Every input with its period and sources; an EV bridge line the filings do not report there = value 0, `reported: false`. */
  inputs: jsonb("inputs").$type<Record<string, { value: number; period: string; sources: string[]; reported?: false }>>().notNull(),
  rebuiltAt,
});
export type GoldValuation = typeof valuations.$inferSelect;
