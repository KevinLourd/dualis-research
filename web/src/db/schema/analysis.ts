import { doublePrecision, index, integer, jsonb, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * The analysis of a ticker in Thierry's method (docs/thierry-method.md), names fixed by Kevin 2026-11-05:
 * Fair Value, Quote, Narrative, Narrative Driver, Driver Category, Exhibit, Evidence, Signal, Signal Change,
 * Research Report, Update Note. Claude writes the text and picks the charts ONCE per input hash (dimension `analysis`);
 * every number on a chart is read from gold (financials, consensus, prices), never from the model.
 */

/** Driver Category: Thierry's own Substack sections, a fixed catalogue. */
export const DRIVER_CATEGORIES = [
  "Industry & cycle",
  "Business economics",
  "Consensus expectations",
  "Balance sheet & capital",
  "Management & insiders",
  "Corporate events",
  "Macro & policy",
] as const;
export type DriverCategory = (typeof DRIVER_CATEGORIES)[number];

/**
 * What a news item does to a Narrative Driver, what a driver's news add up to, and where the whole narrative stands
 * (Kevin 2026-11-06). reversal = the reason the market holds turns against it (shown "Inflection" when the price sits
 * below fair value, "Crack" above); continuation = it strengthens the reason; noise = it does not touch it.
 */
export type EvidenceEffect = "reversal" | "continuation" | "noise";
export type Strength = "strong" | "weak" | "noise";
/** The five tags, strongest reversal first: `<effect>:<strength>` or `noise`. */
export const NARRATIVE_TAGS = ["reversal:strong", "reversal:weak", "noise", "continuation:weak", "continuation:strong"] as const;
export type NarrativeTag = (typeof NARRATIVE_TAGS)[number];
export function parseTag(tag: string): { effect: EvidenceEffect; strength: Strength } {
  if (tag === "noise") return { effect: "noise", strength: "noise" };
  const [effect, strength] = tag.split(":");
  if (!NARRATIVE_TAGS.includes(tag as NarrativeTag)) throw new Error(`"${tag}" is not one of ${NARRATIVE_TAGS.join(", ")}`);
  return { effect: effect as EvidenceEffect, strength: strength as Strength };
}
/** One news item judged against one driver. */
export type EvidenceVerdict = { driverId: string; rank: number; effect: EvidenceEffect; strength: Strength; probability: number; why: string | null; citedSentence: string | null; judgmentId: string };
export type SignalKind = "BUY" | "SELL" | "none";

/** Chart spec the model picks: series keys from the catalogue of stored series (`analysis/series.ts`). */
export type ExhibitSpec = { title: string; chart: "bar" | "line"; series: string[]; takeaway: string };
/** One point of an exhibit, read from gold: period + one value per series key (null = not published for that period). */
export type ExhibitPoint = { period: string; values: Record<string, number | null> };
export type ExhibitSeries = { key: string; label: string; unit: "currency" | "ratio" | "multiple" | "per-share" | "count"; currency: string | null; sources: string[] };

/** Every analysis Claude wrote (append-only, one per ticker x input hash). The latest per ticker is current. */
export const analyses = silver.table(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    /** Hash of everything the analysis read: same inputs, never asked twice. */
    inputHash: text("input_hash").notNull(),
    /** Parsed answer: fair value, narrative, drivers with exhibit specs, report. */
    analysis: jsonb("analysis").$type<AnalysisAnswer>().notNull(),
    report: text("report").notNull(),
    /** Narrative Rationale (analysis@v2+): why the market holds the story, each claim citing its sources. */
    rationale: jsonb("rationale").$type<RationaleAnswer>(),
    model: text("model").notNull(),
    bronzeId: uuid("bronze_id").notNull(),
    /** Quote the analysis was written against. */
    quote: doublePrecision("quote"),
    quoteDate: text("quote_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("analyses_symbol").on(t.symbol, t.createdAt)],
);

/** A rationale source: an Exhibit (by number), an Evidence item (headline), a reported figure (series key + period), the price path (month). */
export type RationaleSource = { type: "exhibit" | "evidence" | "figure" | "price"; ref: string; label: string };
export type RationaleClaim = { text: string; drivers: number[]; sources: RationaleSource[] };
export type RationaleAnswer = { summary: string; claims: RationaleClaim[]; exhibits: ExhibitSpec[] };

export type AnalysisAnswer = {
  fairValue: { value: number; currency: string; method: string; label?: string | null; inputs: { label: string; value: number; period: string }[] };
  narrative: string;
  narrativeDetail?: string | null;
  /** Every driver SUPPORTS the narrative: a reason the market holds it (never one that weakens it, Kevin 2026-11-06). */
  drivers: { category: DriverCategory; title: string; summary?: string | null; text: string; exhibits: ExhibitSpec[] }[];
};

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Fair Value per ticker: Thierry's number when he typed one, else Claude's, with its one-line method. */
export const fairValues = gold.table("fair_values", {
  symbol: text("symbol").primaryKey(),
  value: doublePrecision("value").notNull(),
  currency: text("currency"),
  /** One line: "10x EV/EBITDA, its 5-year median, on FY2025 EBITDA KRW 61B -> KRW 12,400 / share". */
  method: text("method"),
  /** The method in a few words, no arithmetic ("5.9x EV/EBITDA, 4-year median"); `method` = the full calculation (item panel). */
  label: text("label"),
  /** "thierry" (his console edit) or "claude". */
  author: text("author").$type<"thierry" | "claude">().notNull(),
  /** Claude's own figure, kept when Thierry's wins. */
  claudeValue: doublePrecision("claude_value"),
  claudeMethod: text("claude_method"),
  /** The figures Claude's method used, as given to it from gold. */
  inputs: jsonb("inputs").$type<{ label: string; value: number; period: string }[]>().notNull(),
  /** = silver.analyses.id of Claude's version. */
  version: uuid("version"),
  asOf: timestamp("as_of", { withTimezone: true }),
  rebuiltAt,
});
export type GoldFairValue = typeof fairValues.$inferSelect;

/** Narrative: why the price sits where it does vs the fair value, so far. One paragraph. */
export const narratives = gold.table("narratives", {
  symbol: text("symbol").primaryKey(),
  /** ONE plain sentence (Kevin: « phrase simple: sujet verbe complément »). */
  text: text("text").notNull(),
  /** The longer why (3-5 sentences, figures), for the item panel. */
  detail: text("detail"),
  version: uuid("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldNarrative = typeof narratives.$inferSelect;

/**
 * Narrative Rationale (Kevin 2026-11-05: « une AI qui donne le rationnel derrière cette narrative »): why the market holds
 * the story, built on the evidence (price path, 5 years of reported numbers, consensus, the news that shaped it). Each
 * claim names the drivers it rests on and cites its sources; its own exhibits sit in gold.exhibits with driver id
 * `<symbol>:rationale`.
 */
export const narrativeRationales = gold.table("narrative_rationales", {
  symbol: text("symbol").primaryKey(),
  /** One or two sentences: the rationale in short. */
  summary: text("summary").notNull(),
  claims: jsonb("claims").$type<RationaleClaim[]>().notNull(),
  exhibitIds: text("exhibit_ids").array().notNull(),
  version: uuid("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldNarrativeRationale = typeof narrativeRationales.$inferSelect;

/**
 * Narrative Driver: a reason the market holds the narrative (below fair value: why it is pessimistic; above: why it is
 * optimistic). 1 to 5 per ticker, each in ONE Driver Category. id = `<symbol>:<rank>`.
 */
export const narrativeDrivers = gold.table(
  "narrative_drivers",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    rank: integer("rank").notNull(),
    category: text("category").$type<DriverCategory>().notNull(),
    title: text("title").notNull(),
    /** ONE plain sentence shown under the title; `text` = the full description (item panel). */
    summary: text("summary"),
    text: text("text").notNull(),
    version: uuid("version").notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_narrative_drivers_symbol").on(t.symbol)],
);
export type GoldNarrativeDriver = typeof narrativeDrivers.$inferSelect;

/** Exhibit: a chart bound to stored series, its data read from gold at rebuild. id = `<driver id>:<rank>`. */
export const exhibits = gold.table(
  "exhibits",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    driverId: text("driver_id").notNull(),
    rank: integer("rank").notNull(),
    /** Report numbering: EXHIBIT 1, 2... across the ticker. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    chart: text("chart").$type<"bar" | "line">().notNull(),
    series: jsonb("series").$type<ExhibitSeries[]>().notNull(),
    points: jsonb("points").$type<ExhibitPoint[]>().notNull(),
    takeaway: text("takeaway").notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_exhibits_symbol").on(t.symbol)],
);
export type GoldExhibit = typeof exhibits.$inferSelect;

/**
 * Evidence: every news item and filing of the last 12 months, judged against EACH Narrative Driver (`verdicts`).
 * driver_id / effect / strength / why = its strongest verdict (what ranks the item). id = `<symbol>|<news|filing>:<item id>`.
 */
export const evidence = gold.table(
  "evidence",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    /** The driver of the strongest verdict; null when the item is noise for every driver. */
    driverId: text("driver_id"),
    effect: text("effect").$type<EvidenceEffect>().notNull(),
    strength: text("strength").$type<Strength>().notNull(),
    probability: real("probability").notNull(),
    why: text("why"),
    citedSentence: text("cited_sentence"),
    exhibitId: text("exhibit_id"),
    kind: text("kind").$type<"news" | "filing">().notNull(),
    headline: text("headline").notNull(),
    url: text("url"),
    publisher: text("publisher"),
    eventDay: text("event_day").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    /** The article or filing behind it (one of the two). */
    newsItemIds: uuid("news_item_ids").array().notNull().default([]),
    filingIds: uuid("filing_ids").array().notNull().default([]),
    sources: text("sources").array().notNull().default([]),
    judgmentId: uuid("judgment_id").notNull(),
    /** One verdict per driver, in rank order. */
    verdicts: jsonb("verdicts").$type<EvidenceVerdict[]>().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_evidence_symbol").on(t.symbol, t.eventAt)],
);
export type GoldEvidence = typeof evidence.$inferSelect;

/**
 * Narrative State (dimension `narrative-state`): where each driver stands given all its judged news (level `driver`,
 * id = driver id), then where the whole narrative stands given its drivers (level `ticker`, id = symbol). Same five tags
 * as the news; the LLM weighs them (several weak reversals can make a strong one).
 */
export const narrativeStates = gold.table(
  "narrative_states",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    level: text("level").$type<"driver" | "ticker">().notNull(),
    driverId: text("driver_id"),
    effect: text("effect").$type<EvidenceEffect>().notNull(),
    strength: text("strength").$type<Strength>().notNull(),
    why: text("why"),
    probability: real("probability").notNull(),
    /** The Evidence the verdict rests on (driver: its non-noise news; ticker: the reversals behind it). */
    evidenceIds: text("evidence_ids").array().notNull(),
    judgmentId: uuid("judgment_id").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_narrative_states_symbol").on(t.symbol)],
);
export type GoldNarrativeState = typeof narrativeStates.$inferSelect;

/**
 * Signal per ticker, from Fair Value, Quote and the ticker's Narrative State: BUY = the narrative in reversal with the
 * price BELOW fair value; SELL = in reversal with the price ABOVE; else none. Strength = the state's strength.
 */
export const signals = gold.table("signals", {
  symbol: text("symbol").primaryKey(),
  signal: text("signal").$type<SignalKind>().notNull(),
  strength: text("strength").$type<Strength>().notNull(),
  fairValue: doublePrecision("fair_value"),
  fairValueMethod: text("fair_value_method"),
  /** Short method label ("5.9x EV/EBITDA, 4-year median"); the method above is the full calculation. */
  fairValueLabel: text("fair_value_label"),
  currency: text("currency"),
  quote: doublePrecision("quote"),
  quoteDate: text("quote_date"),
  /** quote / fair value - 1 (negative = below fair value). */
  gapPct: doublePrecision("gap_pct"),
  /** The Evidence behind the signal (its reversals), strongest first. */
  evidenceIds: text("evidence_ids").array().notNull(),
  /** Since when the ticker has this signal and strength. */
  since: timestamp("since", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldSignal = typeof signals.$inferSelect;

/** Every Signal state ever computed per ticker (append on change only): the history Signal Changes come from. */
export const signalStates = silver.table(
  "signal_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    signal: text("signal").$type<SignalKind>().notNull(),
    strength: text("strength").$type<Strength>().notNull(),
    evidenceIds: text("evidence_ids").array().notNull(),
    gapPct: doublePrecision("gap_pct"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** First state of a ticker = baseline: never a Signal Change. */
    baseline: integer("baseline").notNull().default(0),
    /** Update Note (Claude, once per change); null on the baseline. */
    updateNote: text("update_note"),
    model: text("model"),
    /** Prompt version of the note (`NOTE_VERSION`): an older one is written again once. */
    noteVersion: text("note_version"),
  },
  (t) => [index("signal_states_symbol").on(t.symbol, t.at)],
);

/** Signal Change: a ticker's signal or strength changed after its baseline, with its Update Note. */
export const signalChanges = gold.table(
  "signal_changes",
  {
    /** = silver.signal_states.id of the new state. */
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    fromSignal: text("from_signal").$type<SignalKind>().notNull(),
    toSignal: text("to_signal").$type<SignalKind>().notNull(),
    fromStrength: text("from_strength").$type<Strength>().notNull(),
    toStrength: text("to_strength").$type<Strength>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    updateNote: text("update_note"),
    evidenceIds: text("evidence_ids").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_signal_changes_at").on(t.at), index("gold_signal_changes_symbol").on(t.symbol, t.at)],
);
export type GoldSignalChange = typeof signalChanges.$inferSelect;

/** Research Report: equity-research style, markdown, `[EXHIBIT n]` markers = gold.exhibits.number of the ticker. */
export const researchReports = gold.table("research_reports", {
  symbol: text("symbol").primaryKey(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  exhibitIds: text("exhibit_ids").array().notNull(),
  version: uuid("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  model: text("model").notNull(),
  rebuiltAt,
});
export type GoldResearchReport = typeof researchReports.$inferSelect;
