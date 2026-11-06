import { doublePrecision, index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * The fair value pyramid (Kevin 2026-11-06, the industry's "football field"): a FIXED list of Valuation Methods; per
 * ticker one Method Valuation per method (Claude picks the low / base / high assumptions with a why for each, the code
 * does the arithmetic from reported figures); then one synthesis weighs them into the Fair Value and its range, with a
 * Valuation Report that consolidates every method's report.
 */

export type ValuationMethodId = "ev-ebitda" | "pe" | "pb" | "dcf" | "net-assets" | "dividend-yield" | "peers" | "analyst-targets";
export type Scenario = "low" | "base" | "high";

/** One input of a method, as read from gold: what, its value, the period, the sources. */
export type ValuationInput = { key: string; label: string; value: number; unit: "currency" | "per-share" | "count" | "multiple" | "ratio"; period: string; sources: string[] };
/** One calculation line, its value under each scenario (same value thrice for a fixed input). */
export type ValuationStep = { label: string; unit: ValuationInput["unit"]; low: number; base: number; high: number };
/** One assumption Claude picked, per scenario, with why. */
export type ValuationAssumption = { key: string; label: string; unit: "multiple" | "ratio"; low: number; base: number; high: number; why: string };
/** The history a method reads against (its multiple per fiscal year, FCF per year...), computed from gold. */
export type ValuationHistory = { label: string; unit: ValuationInput["unit"]; points: { period: string; value: number }[] } | null;
/** One comparable company of the peers method: its multiples today. */
export type PeerRow = { symbol: string; name: string | null; currency: string | null; evEbitda: number | null; pe: number | null; sources: string[] };

export type MethodResult = {
  applicable: boolean;
  /** Why not applicable, or null. */
  reason: string | null;
  currency: string | null;
  low: number | null;
  base: number | null;
  high: number | null;
  /** Which base the method used when it has a choice (P/E: trailing / forward; DCF: last year / 3-year average FCF). */
  basis: string | null;
  assumptions: ValuationAssumption[];
  steps: ValuationStep[];
  inputs: ValuationInput[];
  history: ValuationHistory;
  peers: PeerRow[];
  /** One sentence: the value and what drives it. */
  summary: string | null;
  /** The method's own report, markdown, 120-250 words. */
  report: string | null;
};

/** Every Method Valuation ever made (append-only, one per ticker x method x input hash). */
export const methodValuations = silver.table(
  "method_valuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    method: text("method").$type<ValuationMethodId>().notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<MethodResult>().notNull(),
    model: text("model"),
    bronzeId: uuid("bronze_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("method_valuations_key").on(t.symbol, t.method, t.inputHash)],
);

export type MethodWeight = { method: ValuationMethodId; weight: number; why: string };
export type SynthesisResult = { currency: string | null; low: number; base: number; high: number; weights: MethodWeight[]; label: string; summary: string; report: string };

/** Every synthesis ever made (append-only, one per ticker x hash of its method results). */
export const valuationSyntheses = silver.table(
  "valuation_syntheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<SynthesisResult>().notNull(),
    model: text("model"),
    bronzeId: uuid("bronze_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("valuation_syntheses_key").on(t.symbol, t.inputHash)],
);

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Valuation Method: the fixed catalogue (rebuilt from code each run). */
export const valuationMethods = gold.table("valuation_methods", {
  id: text("id").$type<ValuationMethodId>().primaryKey(),
  rank: integer("rank").notNull(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  description: text("description").notNull(),
  rebuiltAt,
});
export type GoldValuationMethod = typeof valuationMethods.$inferSelect;

/** Method Valuation: one method on one ticker, current version. id = `<symbol>:<method>`. */
export const goldMethodValuations = gold.table(
  "method_valuations",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    method: text("method").$type<ValuationMethodId>().notNull(),
    applicable: integer("applicable").notNull(),
    reason: text("reason"),
    currency: text("currency"),
    low: doublePrecision("low"),
    base: doublePrecision("base"),
    high: doublePrecision("high"),
    basis: text("basis"),
    assumptions: jsonb("assumptions").$type<ValuationAssumption[]>().notNull(),
    steps: jsonb("steps").$type<ValuationStep[]>().notNull(),
    inputs: jsonb("inputs").$type<ValuationInput[]>().notNull(),
    history: jsonb("history").$type<ValuationHistory>(),
    peers: jsonb("peers").$type<PeerRow[]>().notNull(),
    summary: text("summary"),
    report: text("report"),
    /** Latest date the method's data carries (`dataAsOf`): how fresh it is, not when it was computed. */
    dataAsOf: timestamp("data_as_of", { withTimezone: true }),
    /** = silver.method_valuations.id */
    version: uuid("version").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_method_valuations_symbol").on(t.symbol)],
);
export type GoldMethodValuation = typeof goldMethodValuations.$inferSelect;

/** Valuation Report: the synthesis behind the Fair Value (weights with why, range, consolidated report). */
export const valuationReports = gold.table("valuation_reports", {
  symbol: text("symbol").primaryKey(),
  currency: text("currency"),
  low: doublePrecision("low").notNull(),
  base: doublePrecision("base").notNull(),
  high: doublePrecision("high").notNull(),
  weights: jsonb("weights").$type<MethodWeight[]>().notNull(),
  label: text("label").notNull(),
  summary: text("summary").notNull(),
  markdown: text("markdown").notNull(),
  /** = silver.valuation_syntheses.id */
  version: uuid("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldValuationReport = typeof valuationReports.$inferSelect;

/** Comparable listed companies Claude picked for a ticker (append-only, one per ticker x profile hash). */
export type PeerPick = { symbol: string; name: string; why: string };
export const peerSets = silver.table(
  "peer_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    inputHash: text("input_hash").notNull(),
    peers: jsonb("peers").$type<PeerPick[]>().notNull(),
    model: text("model"),
    bronzeId: uuid("bronze_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("peer_sets_key").on(t.symbol, t.inputHash)],
);

/** One comparable company of a ticker with its multiples today (Yahoo). id = `<symbol>|<peer symbol>`. */
export const peers = gold.table(
  "peers",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    peerSymbol: text("peer_symbol").notNull(),
    name: text("name"),
    why: text("why"),
    currency: text("currency"),
    evEbitda: doublePrecision("ev_ebitda"),
    pe: doublePrecision("pe"),
    marketCap: doublePrecision("market_cap"),
    sources: text("sources").array().notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_peers_symbol").on(t.symbol)],
);
export type GoldPeer = typeof peers.$inferSelect;

/** Analyst price targets on a ticker (Yahoo financialData), as published. */
export const analystTargets = gold.table("analyst_targets", {
  symbol: text("symbol").primaryKey(),
  low: doublePrecision("low").notNull(),
  mean: doublePrecision("mean").notNull(),
  high: doublePrecision("high").notNull(),
  analysts: integer("analysts"),
  currency: text("currency"),
  sources: text("sources").array().notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldAnalystTarget = typeof analystTargets.$inferSelect;
