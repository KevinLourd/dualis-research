import { index, integer, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Catalysts dimension. A catalyst = a news item or a filing that says something about the market's narrative on a
 * ticker: it `contradicts` it (the story cracks, what Thierry's view needs) or `continues` it.
 * Bronze = each raw judgment call (bronze.fetches, dimension "catalysts"); the judgment itself is stored once in
 * silver.judgments. Silver = one event per (ticker, direction, day), every item id and source tag behind it.
 * Gold = the evidence list the ticker page reads.
 */

export type CatalystDirection = "contradicts" | "continues";
export type CatalystKind = "news" | "filing";

export const catalystEvents = silver.table(
  "catalyst_events",
  {
    /** `<symbol>:<direction>:<day>`. */
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    kind: text("kind").$type<CatalystKind>().notNull(),
    direction: text("direction").$type<CatalystDirection>().notNull(),
    eventDay: text("event_day").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    probability: real("probability").notNull(),
    reason: text("reason"),
    evidence: text("evidence"),
    /** The strongest item of the day: `news:<uuid>` or `filing:<uuid>`. */
    topItem: text("top_item"),
    newsItemIds: uuid("news_item_ids").array().notNull(),
    filingIds: uuid("filing_ids").array().notNull(),
    judgmentIds: uuid("judgment_ids").array().notNull(),
    sources: text("sources").array().notNull(),
    lastRebuiltAt: timestamp("last_rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("catalyst_events_key").on(t.symbol, t.direction, t.eventDay), index("catalyst_events_symbol").on(t.symbol)],
);
export type SilverCatalystEvent = typeof catalystEvents.$inferSelect;

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Events at or above the judge's bar, ready to show: the top item's headline, link and publisher. */
export const goldCatalysts = gold.table(
  "catalysts",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    kind: text("kind").$type<CatalystKind>().notNull(),
    eventDay: text("event_day").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    direction: text("direction").$type<CatalystDirection>().notNull(),
    probability: real("probability").notNull(),
    reason: text("reason"),
    evidence: text("evidence"),
    /** One-liner: the top article or filing title. */
    headline: text("headline").notNull(),
    url: text("url"),
    publisher: text("publisher"),
    newsItemIds: uuid("news_item_ids").array().notNull(),
    filingIds: uuid("filing_ids").array().notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_catalysts_symbol").on(t.symbol, t.eventAt), index("gold_catalysts_day").on(t.eventDay)],
);
export type GoldCatalyst = typeof goldCatalysts.$inferSelect;

/** The market's narrative on a ticker: still holding, or cracking (labelled "inflecting" on a long). */
export type NarrativeState = "holds" | "cracking";

/** One stored judgment of ALL the evidence so far on a ticker (silver of the thesis-confidence dimension). */
export const thesisAssessments = silver.table(
  "thesis_assessments",
  {
    judgmentId: uuid("judgment_id").primaryKey(),
    symbol: text("symbol").notNull(),
    evidenceKey: text("evidence_key").notNull(),
    evidenceIds: text("evidence_ids").array().notNull(),
    state: text("state").$type<NarrativeState>().notNull(),
    probability: real("probability").notNull(),
    reason: text("reason"),
    citedEvidence: text("cited_evidence"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    bronzeId: uuid("bronze_id").notNull(),
    sources: text("sources").array().notNull(),
  },
  (t) => [index("thesis_assessments_symbol").on(t.symbol, t.assessedAt)],
);

/** Current narrative state per active ticker. */
export const thesisConfidence = gold.table("thesis_confidence", {
  symbol: text("symbol").primaryKey(),
  state: text("state").$type<NarrativeState>().notNull(),
  probability: real("probability"),
  reason: text("reason"),
  evidenceCount: integer("evidence_count").notNull(),
  assessedAt: timestamp("assessed_at", { withTimezone: true }),
  /** Since when the ticker is in this state (last transition, or null when it never changed). */
  since: timestamp("since", { withTimezone: true }),
  rebuiltAt,
});
export type GoldThesisConfidence = typeof thesisConfidence.$inferSelect;

/**
 * Every change of narrative state = one signal, newest last. A ticker's FIRST assessment is its baseline (no signal):
 * only a later change is. Stable contract: the WhatsApp sender reads this table.
 */
export const thesisTransitions = gold.table(
  "thesis_transitions",
  {
    /** = the judgment id of the assessment that changed the state. */
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    fromState: text("from_state").$type<NarrativeState>().notNull(),
    toState: text("to_state").$type<NarrativeState>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** Why, one plain sentence from the judge. */
    reason: text("reason"),
    citedEvidence: text("cited_evidence"),
    probability: real("probability").notNull(),
    evidenceIds: text("evidence_ids").array().notNull(),
    judgmentId: uuid("judgment_id").notNull(),
    rebuiltAt,
  },
  (t) => [index("thesis_transitions_at").on(t.at), index("thesis_transitions_symbol").on(t.symbol, t.at)],
);
export type GoldThesisTransition = typeof thesisTransitions.$inferSelect;
