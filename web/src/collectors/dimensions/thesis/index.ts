import { and, eq } from "drizzle-orm";
import { promoteFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { rebuildGoldTheses, THESIS_DIMENSION } from "./gold";
import { claudeResearch, prepareResearch, RESEARCH_SOURCE, type ResearchThesis } from "./research";
import { CLAUDE_SOURCE, CONSOLE_SOURCE, NOTES_SOURCE, watchlistNotes } from "./sources";

/**
 * The thesis of each ticker, in Thierry's terms (docs/thierry-method.md): the market's NARRATIVE (what the price
 * says) and his VIEW of it (`summary`: why it is wrong, cracking or turning), plus his FAIR VALUE (his number only).
 * bronze = every authored version (Claude's draft, Thierry's watchlist note, his console edits);
 * silver.facts "thesis" = narrative / summary / fairValue / note / draftAsOf per author; gold = gold.theses.
 * Claude drafts the two sentences once per ticker, with no number; Thierry's word wins.
 */
export const thesis: Dimension = {
  name: THESIS_DIMENSION,
  description: "The market's narrative and Thierry's view of it, drafted once by Claude (no numbers), edited by Thierry; his fair value is his input.",
  sources: [claudeResearch, watchlistNotes],
  subjects: thesisSubjects,
  promote: (db, fetches) => promoteThesis(db, fetches),
};

/** Payload of a console edit (bronze source `console`): one field, its new value. */
export type ConsoleEdit = { field: string; value: unknown; action: "edit" | "accept"; userId: string | null };

/** Active tickers; those without Claude's narrative draft get their evidence gathered for it. */
export async function thesisSubjects(db: Db): Promise<string[]> {
  const symbols = await analysedSymbols(db);
  await prepareResearch(db, symbols);
  return symbols;
}

/** Claude's draft as "claude" facts: the narrative, the view, and the day it was written. */
export function researchAssertions(fetch: BronzeFetch, today: string): Assertion[] {
  const t = (fetch.payload as { thesis: ResearchThesis }).thesis;
  const a = (field: string, value: unknown): Assertion => ({ source: CLAUDE_SOURCE, field, value, bronzeId: fetch.id });
  return [a("narrative", t.narrative), a("summary", t.summary), a("draftAsOf", today)];
}

/**
 * A new draft replaces Claude's earlier version of the ticker: the "claude" tag leaves every earlier fact (a fact
 * nobody asserts any more disappears); Thierry's own facts stay. Bronze keeps the history.
 */
async function retract(db: Db, subject: string, source: string, field?: string): Promise<void> {
  const where = field
    ? and(eq(facts.dimension, THESIS_DIMENSION), eq(facts.subject, subject), eq(facts.field, field))
    : and(eq(facts.dimension, THESIS_DIMENSION), eq(facts.subject, subject));
  for (const f of await db.select().from(facts).where(where)) {
    const i = f.sources.indexOf(source);
    if (i === -1) continue;
    const sources = f.sources.filter((_, j) => j !== i);
    const bronzeIds = f.bronzeIds.filter((_, j) => j !== i);
    if (sources.length === 0) await db.delete(facts).where(eq(facts.id, f.id));
    else await db.update(facts).set({ sources, bronzeIds }).where(eq(facts.id, f.id));
  }
}

/** This run's bronze -> silver.facts "thesis" -> gold.theses. */
export async function promoteThesis(db: Db, fetches: BronzeFetch[], today: string = new Date().toISOString().slice(0, 10)): Promise<PromoteResult> {
  const bySubject = new Map<string, Assertion[]>();
  const push = (subject: string, list: Assertion[]) => bySubject.set(subject, [...(bySubject.get(subject) ?? []), ...list]);
  const counts: Record<string, number> = {};

  const ok = fetches.filter((f) => !f.error).sort((x, y) => x.fetchedAt.getTime() - y.fetchedAt.getTime());
  for (const f of ok) {
    if (f.source === RESEARCH_SOURCE) {
      await retract(db, f.subject, CLAUDE_SOURCE);
      push(f.subject, researchAssertions(f, today));
    } else if (f.source === NOTES_SOURCE) {
      // Thierry's watchlist note is a note to himself ("watch Icahn"), read by the draft as evidence, kept as "note".
      const note = (f.payload as { note: string | null }).note;
      await retract(db, f.subject, NOTES_SOURCE, "note");
      if (note) push(f.subject, [{ source: NOTES_SOURCE, field: "note", value: note, bronzeId: f.id }]);
    } else if (f.source === CONSOLE_SOURCE) {
      const edit = f.payload as ConsoleEdit;
      push(f.subject, [{ source: CONSOLE_SOURCE, field: edit.field, value: edit.value, bronzeId: f.id }]);
    } else {
      throw new Error(`thesis: no reader for source "${f.source}"`);
    }
    counts[f.source] = (counts[f.source] ?? 0) + 1;
  }

  await promoteFacts(db, THESIS_DIMENSION, bySubject);
  await rebuildGoldTheses(db);
  return { silverRowsBySource: counts };
}
