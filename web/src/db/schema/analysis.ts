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
 * below fair value, "Crack" above); continuation = it strengthens the reason; noise = it does not touch it;
 * too-old = a news item from before the market adopted its current story (`narrative-since`): never judged, never a signal.
 */
export type EvidenceEffect = "reversal" | "continuation" | "noise" | "too-old";
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
export type EvidenceVerdict = { driverId: string; side?: ThesisSide; rank: number; effect: EvidenceEffect; strength: Strength; probability: number; why: string | null; citedSentence: string | null; judgmentId: string; pricedIn?: PricedIn | null };
export type SignalKind = "BUY" | "SELL" | "none";
/** How much of a news item's (or a driver's) turn the price has already moved, as the judge reads it. */
export type PricedIn = "none" | "partly" | "fully";
export const PRICED_IN: readonly PricedIn[] = ["none", "partly", "fully"];

/**
 * Thesis side (Kevin 2026-11-09): the LONG thesis = the pessimistic story the market holds (why the price sits at or
 * below fair value; its turn is an inflection, a BUY); the SHORT thesis = the optimistic story (why it sits at or above;
 * its turn is a crack, a SELL). Price below the fair value range: long only; above it: short only; inside the range:
 * BOTH theses are written and judged in competition, and only one that signals alone surfaces (`signals`).
 */
export type ThesisSide = "long" | "short";
export const THESIS_SIDES: readonly ThesisSide[] = ["long", "short"];

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
    /** The thesis this analysis writes (null on rows before the two theses: never read). */
    side: text("side").$type<ThesisSide>(),
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
  /** Up to analysis@v4 the analysis wrote the fair value; since v5 the `valuation` dimension does (the pyramid). */
  fairValue?: { value: number; currency: string; method: string; label?: string | null; inputs: { label: string; value: number; period: string }[] };
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
  /** Range of the Valuation Report (weighted low / high of the methods); null when Thierry's number wins. */
  low: doublePrecision("low"),
  high: doublePrecision("high"),
  /** One line: the weighted methods ("EV/EBITDA 40%, DCF 35%, P/E 25%"), or Thierry's basis. */
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
  /** `<symbol>:<side>`: one narrative per thesis. */
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").$type<ThesisSide>().notNull(),
  /** ONE plain sentence (Kevin: « phrase simple: sujet verbe complément »). */
  text: text("text").notNull(),
  /** The longer why (3-5 sentences, figures), for the item panel. */
  detail: text("detail"),
  /** Hash of the narrative and its drivers' words: a rewrite with the same words keeps every judgment built on it. */
  version: text("version").notNull(),
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
  /** `<symbol>:<side>`. */
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").$type<ThesisSide>().notNull(),
  /** One or two sentences: the rationale in short. */
  summary: text("summary").notNull(),
  claims: jsonb("claims").$type<RationaleClaim[]>().notNull(),
  exhibitIds: text("exhibit_ids").array().notNull(),
  version: text("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  rebuiltAt,
});
export type GoldNarrativeRationale = typeof narrativeRationales.$inferSelect;

/**
 * Narrative Driver: a reason the market holds the narrative (below fair value: why it is pessimistic; above: why it is
 * optimistic). 1 to 5 per thesis, each in ONE Driver Category. id = `<symbol>:<side>:<rank>`.
 */
export const narrativeDrivers = gold.table(
  "narrative_drivers",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    side: text("side").$type<ThesisSide>().notNull(),
    rank: integer("rank").notNull(),
    category: text("category").$type<DriverCategory>().notNull(),
    title: text("title").notNull(),
    /** ONE plain sentence shown under the title; `text` = the full description (item panel). */
    summary: text("summary"),
    text: text("text").notNull(),
    version: text("version").notNull(),
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
 * Narrative State (dimension `narrative-state`): where each driver stands given all its judged news, their dates and
 * what the price did since (level `driver`, id = driver id), then where the whole thesis stands and whether it signals
 * NOW, given its drivers, the fair value (base, low, high) and the price path (level `thesis`, id = `<symbol>:<side>`).
 * Same five tags as the news; the LLM weighs them (several weak reversals can make a strong one).
 */
export const narrativeStates = gold.table(
  "narrative_states",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    side: text("side").$type<ThesisSide>().notNull(),
    level: text("level").$type<"driver" | "thesis">().notNull(),
    driverId: text("driver_id"),
    effect: text("effect").$type<EvidenceEffect>().notNull(),
    strength: text("strength").$type<Strength>().notNull(),
    why: text("why"),
    probability: real("probability").notNull(),
    /** The Evidence the verdict rests on (driver: its non-noise news; ticker: the reversals behind it). */
    evidenceIds: text("evidence_ids").array().notNull(),
    /** Driver level: the current state in 4-5 words with its number (« YTD margin 30% vs 2023 »), as the judge writes it. */
    headline: text("headline"),
    /** The day the current state started (the first news of the turn), as the judge reads it. */
    since: text("since"),
    /** How much of that turn the price has already moved. */
    pricedIn: text("priced_in").$type<PricedIn>(),
    /** Thesis level only: the signal this thesis gives NOW (strong / weak) or none, decided by the judge. */
    signal: text("signal").$type<Strength>(),
    judgmentId: uuid("judgment_id").notNull(),
    /** When the judge made this verdict (never the time of the run that re-read it). */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_narrative_states_symbol").on(t.symbol)],
);
export type GoldNarrativeState = typeof narrativeStates.$inferSelect;

/** One thesis' reading, kept on the ticker's signal so the board shows both when they compete. */
export type ThesisReading = { side: ThesisSide; signal: Strength; effect: EvidenceEffect; strength: Strength; why: string | null; since: string | null };

/**
 * Signal per ticker (Kevin 2026-11-09): the judge decides per thesis (narrative-state, level `thesis`) whether it signals
 * now: a long thesis can give a BUY, a short one a SELL. One thesis (price outside the fair value range): its signal.
 * Two theses (price inside the range): the signal of the one that signals alone; both or neither = no signal.
 */
export const signals = gold.table("signals", {
  symbol: text("symbol").primaryKey(),
  signal: text("signal").$type<SignalKind>().notNull(),
  strength: text("strength").$type<Strength>().notNull(),
  /** The thesis the signal comes from (null = no signal). */
  side: text("side").$type<ThesisSide>(),
  /** Why, in the judge's words (the signalling thesis; or why none surfaces). */
  why: text("why"),
  /** Every current thesis' reading: one outside the fair value range, two inside. */
  theses: jsonb("theses").$type<ThesisReading[]>().notNull().default([]),
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

/**
 * Live test, signal events (Kevin 2026-11-09): every reading of a ticker's signal at its exact time, the first one
 * included (signal_changes skips that baseline), so the page shows when we said weak / strong inflection or crack, when
 * we changed it and when we removed it. = silver.signal_states, rebuilt by `signals`.
 */
export const signalEvents = gold.table(
  "signal_events",
  {
    /** = silver.signal_states.id. */
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    signal: text("signal").$type<SignalKind>().notNull(),
    strength: text("strength").$type<Strength>().notNull(),
    /** The reading before (null on the first one). */
    fromSignal: text("from_signal").$type<SignalKind>(),
    fromStrength: text("from_strength").$type<Strength>(),
    updateNote: text("update_note"),
    rebuiltAt,
  },
  (t) => [index("gold_signal_events_at").on(t.at)],
);
export type GoldSignalEvent = typeof signalEvents.$inferSelect;

/**
 * Live test, positions: one per signal reading that is a BUY (long) or a SELL (short); the next reading of the ticker
 * closes it, whatever it is (none, the other side, or the same side at another strength: weak -> strong closes the weak
 * position and opens a strong one, Kevin 2026-11-09). Entry and exit at the last close the ticker's market had printed
 * at the signal time; an open position is marked to the latest close. No trading costs. Rebuilt by `signals`.
 */
export const livePositions = gold.table(
  "live_positions",
  {
    /** = silver.signal_states.id of the reading that opened it. */
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    side: text("side").$type<"long" | "short">().notNull(),
    strength: text("strength").$type<"strong" | "weak">().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    /** Null while open. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Null when no price was stored before the signal. `*_date` = the trading day, `*_at` = when that price was known. */
    entryDate: text("entry_date"),
    entryPrice: doublePrecision("entry_price"),
    entryAt: timestamp("entry_at", { withTimezone: true }),
    /** `intraday` = a 5-minute bar, `close` = the day's close (the market was shut). */
    entrySource: text("entry_source").$type<PriceBasis>(),
    exitDate: text("exit_date"),
    exitPrice: doublePrecision("exit_price"),
    exitAt: timestamp("exit_at", { withTimezone: true }),
    exitSource: text("exit_source").$type<PriceBasis>(),
    /** The price the return reads on: the exit, else the latest price (5-minute bar or close). */
    markDate: text("mark_date"),
    markPrice: doublePrecision("mark_price"),
    markAt: timestamp("mark_at", { withTimezone: true }),
    markSource: text("mark_source").$type<PriceBasis>(),
    return: doublePrecision("return"),
    currency: text("currency"),
    rebuiltAt,
  },
  (t) => [index("gold_live_positions_symbol").on(t.symbol, t.openedAt)],
);
export type GoldLivePosition = typeof livePositions.$inferSelect;

/** Where a live-test price comes from: a 5-minute bar, or the day's close when the market was shut. */
export type PriceBasis = "intraday" | "close";

/**
 * Live test, the S&P 500 the book is compared with: bought at the price known when the first signal fired, marked to
 * the latest price, same rule as a position. One row (`symbol` = ^GSPC). Rebuilt by `signals`.
 */
export const liveBenchmark = gold.table("live_benchmark", {
  symbol: text("symbol").primaryKey(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  baseDate: text("base_date").notNull(),
  basePrice: doublePrecision("base_price").notNull(),
  baseAt: timestamp("base_at", { withTimezone: true }).notNull(),
  baseSource: text("base_source").$type<PriceBasis>().notNull(),
  markDate: text("mark_date").notNull(),
  markPrice: doublePrecision("mark_price").notNull(),
  markAt: timestamp("mark_at", { withTimezone: true }).notNull(),
  markSource: text("mark_source").$type<PriceBasis>().notNull(),
  rebuiltAt,
});
export type GoldLiveBenchmark = typeof liveBenchmark.$inferSelect;

/** Research Report: equity-research style, markdown, `[EXHIBIT n]` markers = gold.exhibits.number of the ticker. */
export const researchReports = gold.table("research_reports", {
  /** `<symbol>:<side>`: one report per thesis. */
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").$type<ThesisSide>().notNull(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  exhibitIds: text("exhibit_ids").array().notNull(),
  version: text("version").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  model: text("model").notNull(),
  rebuiltAt,
});
export type GoldResearchReport = typeof researchReports.$inferSelect;

/**
 * Fair Value History (Kevin 2026-11-09): the fair value as it stood each day (base, low, high), from every valuation
 * synthesis (silver.valuation_syntheses, the last of each day). Point-in-time: what a judge reads "at the news date".
 */
export const fairValueHistory = gold.table(
  "fair_value_history",
  {
    /** `<symbol>|<YYYY-MM-DD>`. */
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    day: text("day").notNull(),
    value: doublePrecision("value").notNull(),
    low: doublePrecision("low"),
    high: doublePrecision("high"),
    currency: text("currency"),
    rebuiltAt,
  },
  (t) => [index("gold_fair_value_history_symbol").on(t.symbol, t.day)],
);
export type GoldFairValueHistory = typeof fairValueHistory.$inferSelect;

/**
 * Market Reaction (Kevin 2026-11-09): what the price did around one news item or filing, computed by code from the
 * stored closes: the close before, the next close, five closes later and today, each vs the S&P 500 over the same days,
 * and the fair value (base, low, high) at the news date and today. id = the Evidence id `<symbol>|<kind>:<item id>`.
 */
export const marketReactions = gold.table(
  "market_reactions",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    eventDay: text("event_day").notNull(),
    currency: text("currency"),
    /** Last close before the event day. */
    beforeDay: text("before_day"),
    closeBefore: doublePrecision("close_before"),
    /** First close on or after the event day, and five closes after it. */
    closeNext: doublePrecision("close_next"),
    close5d: doublePrecision("close_5d"),
    nowDay: text("now_day"),
    closeNow: doublePrecision("close_now"),
    /** Returns from the close before (ratio), and the same for the S&P 500. */
    returnNext: doublePrecision("return_next"),
    return5d: doublePrecision("return_5d"),
    returnNow: doublePrecision("return_now"),
    benchNext: doublePrecision("bench_next"),
    bench5d: doublePrecision("bench_5d"),
    benchNow: doublePrecision("bench_now"),
    /** Fair value as it stood at the event (the first one computed when the event is older; `fv_day` says which). */
    fvDay: text("fv_day"),
    fvThen: doublePrecision("fv_then"),
    fvLowThen: doublePrecision("fv_low_then"),
    fvHighThen: doublePrecision("fv_high_then"),
    fvNow: doublePrecision("fv_now"),
    fvLowNow: doublePrecision("fv_low_now"),
    fvHighNow: doublePrecision("fv_high_now"),
    /**
     * The minute view (Kevin 2026-11-09: « donne les vrais chiffres intraday »): when the item came out, the price known
     * then (the 5-minute bar already closed, else the last close printed, `price_at_event_source`), the latest price
     * the same way, the move between them and the S&P 500's over the same span. Null when no price was stored then.
     */
    eventAt: timestamp("event_at", { withTimezone: true }),
    priceAtEvent: doublePrecision("price_at_event"),
    priceAtEventAt: timestamp("price_at_event_at", { withTimezone: true }),
    priceAtEventSource: text("price_at_event_source").$type<PriceBasis>(),
    priceNow: doublePrecision("price_now"),
    priceNowAt: timestamp("price_now_at", { withTimezone: true }),
    priceNowSource: text("price_now_source").$type<PriceBasis>(),
    returnSinceEvent: doublePrecision("return_since_event"),
    benchSinceEvent: doublePrecision("bench_since_event"),
    rebuiltAt,
  },
  (t) => [index("gold_market_reactions_symbol").on(t.symbol, t.eventDay)],
);
export type GoldMarketReaction = typeof marketReactions.$inferSelect;
