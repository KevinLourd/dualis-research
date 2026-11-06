import { and, asc, eq, sql } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import {
  goldCatalysts,
  type NarrativeState,
  thesisAssessments,
  thesisConfidence,
  thesisTransitions,
} from "@/db/schema/catalysts";
import * as silver from "@/db/schema/silver";
import { tickers } from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { analysedSymbols } from "../watchlist";

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const THESIS_CONFIDENCE_DIMENSION = "thesis-confidence";
export const CONFIDENCE_SUBJECT_KIND = "thesis-confidence";
/** Bump when the question changes meaning: every ticker is assessed again. v3 = is the market's narrative cracking. */
export const CONFIDENCE_QUESTION = "narrative@v3";
export const STATES = ["holds", "cracking"] as const satisfies readonly NarrativeState[];
const JUDGE_SOURCE = "claude";
const PARALLEL = 4;

export type Evidence = { id: string; at: string; line: string };

const sure = (p: number) => `${Math.round(p * 100)}% sure`;

/** Everything judged so far for one ticker, oldest first: every item on its evidence list (gold.catalysts, at or above the bar). */
export async function evidenceFor(db: Db, symbol: string): Promise<Evidence[]> {
  const cats = await db.select().from(goldCatalysts).where(eq(goldCatalysts.symbol, symbol));
  return cats
    .map((c) => ({
      id: c.id,
      at: c.eventDay,
      line: `On ${c.eventDay}, ${c.kind === "filing" ? "a filing" : "news"} "${c.headline}" ${c.direction} the narrative (${sure(c.probability)}).${c.reason ? ` ${c.reason}` : ""}`,
    }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Same evidence = same key = never judged twice; one new catalyst or data point = a new key. */
export function evidenceKey(evidence: Evidence[]): string {
  return `${CONFIDENCE_QUESTION}:${fnv(evidence.map((e) => e.id).sort().join("\n"))}`;
}

/** FNV-1a, two seeds, 16 hex chars: pure (the console bundle lists dimensions, no node:crypto). */
function fnv(text: string): string {
  const one = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return one(2166136261) + one(0x9747b28c);
}

/**
 * Evidence dated before the thesis was drafted was in view when it was written: it is marked "known" and cannot by
 * itself crack the narrative. On the first real run (2026-11-04) the unmarked question moved 28 of 37 tickers on
 * readings months old.
 */
export function confidenceRequest(
  symbol: string,
  thesis: { narrative: string | null; summary: string | null; position: string | null; writtenOn: string | null },
  evidence: Evidence[],
): { question: string; input: string } {
  const known = (e: Evidence) => thesis.writtenOn !== null && e.at < thesis.writtenOn;
  const question = [
    `${symbol}, the analyst's position: ${thesis.position ?? "watch"}. Written on ${thesis.writtenOn ?? "an unknown date"}.`,
    `The market's narrative (what the price reflects): ${thesis.narrative ?? "not written yet"}`,
    `The analyst's view of it: ${thesis.summary ?? "not written yet"}`,
    "",
    "The text below is ALL the evidence judged so far, one line per news item or filing, oldest first, each marked contradicts or continues the narrative.",
    "Lines marked [known] were in view when the narrative was written: they are its starting point and cannot crack it by themselves.",
    "Lines marked [new] arrived after: they are what can crack it.",
    "Weigh the new lines as a whole: concrete facts count more than loose ones, several in one direction more than one.",
    "holds = the market's story still stands; cracking = new facts contradict it enough that the market will have to change its story (on a long, the bad story is turning; on a short, the loved story is breaking).",
    "With no new line that changes the picture, the answer is holds. Cite the one line that weighs most.",
  ].join("\n");
  return { question, input: evidence.map((e) => `[${known(e) ? "known" : "new"}] ${e.line}`).join("\n") };
}

/** Tickers whose current evidence has no stored assessment yet. A ticker with no evidence stays at its starting state. */
export async function pendingSymbols(db: Db): Promise<string[]> {
  const done = new Set(
    (
      await db
        .select({ subjectId: silver.judgments.subjectId, questionKey: silver.judgments.questionKey })
        .from(silver.judgments)
        .where(eq(silver.judgments.subjectKind, CONFIDENCE_SUBJECT_KIND))
    ).map((j) => `${j.subjectId}\u0000${j.questionKey}`),
  );
  const out: string[] = [];
  for (const symbol of await analysedSymbols(db)) {
    const evidence = await evidenceFor(db, symbol);
    if (evidence.length > 0 && !done.has(`${symbol}\u0000${evidenceKey(evidence)}`)) out.push(symbol);
  }
  return out;
}

export function confidenceSource(complete?: Complete): Source {
  return {
    name: JUDGE_SOURCE,
    requiredEnv: complete ? [] : ["CLAUDE_OAUTH_TOKEN"],
    covers: () => true,
    concurrency: PARALLEL,
    fetch: async (symbol: string, ctx: SourceContext): Promise<FetchOutcome> => {
      if (!ctx.db) throw new Error("thesis-confidence: the judge source needs the database");
      // Node only, hidden from the bundler: the console Worker lists dimensions and must never ship the Claude Agent SDK.
      const { judge } = (await nodeImport(new URL("../../../llm/judge.ts", import.meta.url).href)) as typeof import("@/llm/judge");
      const run = complete ?? ctx.complete;
      if (!run) throw new Error("thesis-confidence: no LLM in the collector context (cli.ts sets ctx.complete)");
      const db = ctx.db;
      const evidence = await evidenceFor(db, symbol);
      const key = evidenceKey(evidence);
      const [t] = await db.select().from(theses).where(eq(theses.symbol, symbol));
      const [ticker] = await db.select({ position: tickers.position }).from(tickers).where(eq(tickers.symbol, symbol));
      const { question, input } = confidenceRequest(
        symbol,
        { narrative: t?.narrative ?? null, summary: t?.summary ?? null, position: ticker?.position ?? null, writtenOn: t?.draftAsOf ?? null },
        evidence,
      );
      const j = await judge(db, { subjectKind: CONFIDENCE_SUBJECT_KIND, subjectId: symbol, questionKey: key, question, input, choices: STATES }, run);
      return {
        request: { subjectKind: CONFIDENCE_SUBJECT_KIND, subjectId: symbol, questionKey: key, evidenceIds: evidence.map((e) => e.id) },
        httpStatus: null,
        payload: { judgmentId: j.id, verdict: j.verdict, probability: j.probability, citedSentence: j.citedSentence, reason: j.reason, evidenceIds: evidence.map((e) => e.id), createdAt: j.createdAt },
      };
    },
  };
}

type AssessmentPayload = {
  judgmentId: string;
  verdict: NarrativeState;
  probability: number;
  citedSentence: string | null;
  reason: string | null;
  evidenceIds: string[];
  createdAt: string;
};

/**
 * silver.thesis_assessments from EVERY bronze answer of the dimension (one per judgment, first sighting kept), then gold:
 * the current state per active ticker and each change of state after its first assessment (the baseline).
 */
export async function rebuildConfidence(db: Db): Promise<PromoteResult> {
  const rows = await db
    .select()
    .from(fetches)
    .where(and(eq(fetches.dimension, THESIS_CONFIDENCE_DIMENSION), sql`${fetches.error} is null`))
    .orderBy(asc(fetches.fetchedAt));
  const byJudgment = new Map<string, typeof thesisAssessments.$inferInsert>();
  for (const f of rows) {
    const p = f.payload as AssessmentPayload;
    const key = String((f.request as { questionKey: string }).questionKey);
    // Only the current question counts: an older version's assessments stay in bronze, out of silver and gold.
    if (!key.startsWith(`${CONFIDENCE_QUESTION}:`) || byJudgment.has(p.judgmentId)) continue;
    byJudgment.set(p.judgmentId, {
      judgmentId: p.judgmentId,
      symbol: f.subject,
      evidenceKey: key,
      evidenceIds: p.evidenceIds,
      state: p.verdict,
      probability: p.probability,
      reason: p.reason,
      citedEvidence: p.citedSentence,
      assessedAt: new Date(p.createdAt),
      bronzeId: f.id,
      sources: [f.source],
    });
  }
  const assessments = [...byJudgment.values()];
  await db.delete(thesisAssessments);
  for (let i = 0; i < assessments.length; i += 500) await db.insert(thesisAssessments).values(assessments.slice(i, i + 500));

  const symbols = await analysedSymbols(db);
  const evidenceCounts = new Map<string, number>();
  for (const s of symbols) evidenceCounts.set(s, (await evidenceFor(db, s)).length);
  const { current, transitions } = deriveStates(symbols, assessments as AssessmentRow[], evidenceCounts);
  await db.delete(thesisTransitions);
  if (transitions.length) await db.insert(thesisTransitions).values(transitions);
  await db.delete(thesisConfidence);
  if (current.length) await db.insert(thesisConfidence).values(current);
  return { silverRowsBySource: { [JUDGE_SOURCE]: assessments.length } };
}

type AssessmentRow = typeof thesisAssessments.$inferSelect;

/**
 * Pure: walks each ticker's assessments oldest first. The FIRST assessment is the baseline: it sets the state and is no
 * signal (a new question version re-assesses every ticker at once, which must not send Thierry one message per ticker).
 * Every later change of state is a transition = a signal. A ticker never assessed holds.
 */
export function deriveStates(symbols: string[], assessments: AssessmentRow[], evidenceCounts: Map<string, number>) {
  const current: (typeof thesisConfidence.$inferInsert)[] = [];
  const transitions: (typeof thesisTransitions.$inferInsert)[] = [];
  for (const symbol of symbols) {
    const list = assessments.filter((a) => a.symbol === symbol).sort((a, b) => a.assessedAt.getTime() - b.assessedAt.getTime());
    let state: NarrativeState = list[0]?.state ?? "holds";
    let since: Date | null = null;
    for (const a of list.slice(1)) {
      if (a.state === state) continue;
      transitions.push({
        id: a.judgmentId,
        symbol,
        fromState: state,
        toState: a.state,
        at: a.assessedAt,
        reason: a.reason,
        citedEvidence: a.citedEvidence,
        probability: a.probability,
        evidenceIds: a.evidenceIds,
        judgmentId: a.judgmentId,
      });
      state = a.state;
      since = a.assessedAt;
    }
    const last = list.at(-1);
    current.push({
      symbol,
      state,
      probability: last?.probability ?? null,
      reason: last?.reason ?? null,
      evidenceCount: evidenceCounts.get(symbol) ?? 0,
      assessedAt: last?.assessedAt ?? null,
      since,
    });
  }
  return { current, transitions };
}

/**
 * Narrative state: per ticker, given ALL the evidence so far, does the market's narrative hold or is it cracking? One
 * stored judgment per evidence set (a new judged item = a new set), never on read. Runs after catalysts.
 */
export function thesisConfidenceDimension(complete?: Complete): Dimension {
  return {
    name: THESIS_CONFIDENCE_DIMENSION,
    description: "Per ticker: given every judged news item and filing so far, does the market's narrative hold or crack? Judged once per new evidence.",
    sources: [confidenceSource(complete)],
    subjects: (db) => pendingSymbols(db),
    promote: (db: Db) => rebuildConfidence(db),
  };
}

export const thesisConfidenceDim = thesisConfidenceDimension();
