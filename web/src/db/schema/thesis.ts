import { doublePrecision, text, timestamp } from "drizzle-orm/pg-core";
import { gold } from "./gold";

/**
 * Gold table of the thesis dimension. Its silver is the generic silver.facts (dimension "thesis": one fact per field,
 * tagged by author: `claude` drafts, `watchlist` / `console` = Thierry). Thierry's method (docs/thierry-method.md):
 * price = the market's narrative; his fundamental value says whether the price sits above or below; the signal is the
 * narrative cracking (short) or inflecting (long). No AI number: the fair value is Thierry's input only.
 */

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/**
 * How the active text was reached: `draft` = Claude's only; `accepted` = Thierry took Claude's text as is;
 * `edited` = Thierry rewrote Claude's; `thierry` = Thierry's own, Claude had nothing.
 */
export type ItemState = "draft" | "accepted" | "edited" | "thierry";

export const theses = gold.table("theses", {
  symbol: text("symbol").primaryKey(),
  /** What the market believes: the story the price tells, one sentence (Thierry's word winning). */
  narrative: text("narrative"),
  narrativeState: text("narrative_state").$type<ItemState>(),
  /** His view: why that story is wrong, cracking or about to turn, one sentence (Thierry's word winning). */
  summary: text("summary"),
  summaryState: text("summary_state").$type<ItemState>(),
  /** Thierry's fundamental value per share, in `currency`, and how he got it ("10x EV/EBITDA on 2027 EBITDA"). */
  fairValue: doublePrecision("fair_value"),
  fairValueBasis: text("fair_value_basis"),
  currency: text("currency"),
  /** Date of Claude's draft (evidence before it was in view when it was written). */
  draftAsOf: text("draft_as_of"),
  rebuiltAt,
});

export type GoldThesis = typeof theses.$inferSelect;
