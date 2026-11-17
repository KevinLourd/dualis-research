import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { DRIVER_CATEGORIES, MOVE_CAUSE_KINDS, priceMoveCauses, priceMoves, type DriverCategory, type GoldPriceMove, type GoldPriceMoveCause, type MoveCauseKind, type MoveCite } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { firstJsonObject } from "@/llm/judge";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { analysedSymbols } from "../watchlist";

/**
 * Move Causes (Thierry 2026-11-17): for every significant price move of a stock (`gold.price_moves`, market-reaction),
 * what caused it: a fact about the business (fundamental), the market at large (macro, rates, war, commodities),
 * trading itself (technical: index flows, a placement's pricing, no news at all), or not found. Read from the news and
 * filings dated 3 days before the move to 1 day after it; the judge decides from the items, never a keyword rule.
 * Only the fundamental moves say what the market cares about on this company: the analysis reads them to find the
 * narrative drivers. One stored judgment per move and candidate set; no candidate = unknown, no call.
 */

export const MOVE_CAUSES_DIMENSION = "move-causes";
export const MOVE_SUBJECT_KIND = "price-move";
export const MOVE_QUESTION = "move-cause@v1";
/** Moves per call (the repo speed rule: never one call per tiny item). */
export const MOVES_PER_CALL = 15;
const PARALLEL = 4;
/** The candidate window around a move: from 3 days before its start to 1 day after its end. */
const BEFORE_DAYS = 3;
const AFTER_DAYS = 1;

/** One news item or filing dated around a move. */
export type MoveCandidate = { kind: "news" | "filing"; id: string; title: string; publisher: string | null; summary: string | null; url: string | null; at: Date; sources: string[] };

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000);
/** The window of a move: [start - 3 days 00:00 UTC, end + 1 day 24:00 UTC). */
export const windowOf = (m: Pick<GoldPriceMove, "startDay" | "endDay">) => ({ from: shift(m.startDay, -BEFORE_DAYS), to: shift(m.endDay, AFTER_DAYS + 1) });

/** The stored question key of a move and the items it was judged on: a new item around it asks again. */
export const moveKey = (moveId: string, candidates: MoveCandidate[]) => `${MOVE_QUESTION}:${moveId}:${fnv(candidates.map((c) => `${c.kind}:${c.id}`).sort().join(","))}`;

/** Every news item and filing of the ticker inside any of the moves' windows, per move id (newest first). */
export async function candidatesOf(db: Db, symbol: string, moves: Pick<GoldPriceMove, "id" | "startDay" | "endDay">[]): Promise<Map<string, MoveCandidate[]>> {
  const out = new Map<string, MoveCandidate[]>(moves.map((m) => [m.id, []]));
  if (moves.length === 0) return out;
  const first = moves.reduce((a, m) => (m.startDay < a ? m.startDay : a), moves[0].startDay);
  const from = shift(first, -BEFORE_DAYS);
  const [news, filed] = await Promise.all([
    db
      .select({ id: goldNewsItems.id, title: goldNewsItems.title, publisher: goldNewsItems.publisher, summary: goldNewsItems.summary, url: goldNewsItems.url, publishedAt: goldNewsItems.publishedAt, firstSeenAt: goldNewsItems.firstSeenAt, sources: goldNewsItems.sources })
      .from(goldNewsLinks)
      .innerJoin(goldNewsItems, eq(goldNewsItems.id, goldNewsLinks.newsItemId))
      .where(and(eq(goldNewsLinks.symbol, symbol), gte(goldNewsLinks.firstSeenAt, from))),
    db
      .select({ id: gold.filings.id, form: gold.filings.form, title: gold.filings.title, registry: gold.filings.registry, url: gold.filings.url, filedAt: gold.filings.filedAt, sources: gold.filings.sources })
      .from(gold.filings)
      .where(and(eq(gold.filings.symbol, symbol), gte(gold.filings.filedAt, from))),
  ]);
  const all: MoveCandidate[] = [
    ...news.map((n) => ({ kind: "news" as const, id: String(n.id), title: n.title, publisher: n.publisher, summary: n.summary, url: n.url, at: n.publishedAt ?? n.firstSeenAt, sources: n.sources })),
    ...filed.map((f) => ({ kind: "filing" as const, id: String(f.id), title: f.form ? `${f.form}: ${f.title}` : f.title, publisher: f.registry, summary: null, url: f.url, at: f.filedAt, sources: f.sources })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const m of moves) {
    const w = windowOf(m);
    out.set(m.id, all.filter((c) => c.at >= w.from && c.at < w.to));
  }
  return out;
}

async function movesOfSymbol(db: Db, symbol: string): Promise<GoldPriceMove[]> {
  return db.select().from(priceMoves).where(eq(priceMoves.symbol, symbol)).orderBy(asc(priceMoves.startDay));
}

/** The stored judgments of these moves, by `<move id>\0<question key>`. */
async function storedJudgments(db: Db, moveIds: string[]) {
  if (moveIds.length === 0) return new Map<string, typeof silver.judgments.$inferSelect>();
  const rows = await db.select().from(silver.judgments).where(and(eq(silver.judgments.subjectKind, MOVE_SUBJECT_KIND), inArray(silver.judgments.subjectId, moveIds)));
  return new Map(rows.map((j) => [`${j.subjectId}\u0000${j.questionKey}`, j]));
}

/** Batch subject: `<symbol>|batch|<start day>,<start day>...`. */
export const batchSubject = (symbol: string, moves: Pick<GoldPriceMove, "startDay">[]) => `${symbol}|batch|${moves.map((m) => m.startDay).join(",")}`;
export function parseBatchSubject(subject: string): { symbol: string; ids: string[] } {
  const [symbol, , days] = subject.split("|");
  return { symbol, ids: (days ?? "").split(",").filter(Boolean).map((d) => `${symbol}:${d}`) };
}

/** Moves of the analysed tickers with items around them and no judgment on those items yet, in batches. */
async function pendingSubjects(db: Db): Promise<string[]> {
  const out: string[] = [];
  for (const symbol of await analysedSymbols(db)) {
    const moves = await movesOfSymbol(db, symbol);
    const cands = await candidatesOf(db, symbol, moves);
    const stored = await storedJudgments(db, moves.map((m) => m.id));
    const pending = moves.filter((m) => {
      const c = cands.get(m.id) ?? [];
      return c.length > 0 && !stored.has(`${m.id}\u0000${moveKey(m.id, c)}`);
    });
    // Newest first: the recent moves matter most if a run stops early.
    pending.reverse();
    for (let i = 0; i < pending.length; i += MOVES_PER_CALL) out.push(batchSubject(symbol, pending.slice(i, i + MOVES_PER_CALL)));
  }
  return out;
}

export const MOVE_SYSTEM = [
  "You are an equity research analyst. A stock moved far beyond its normal daily volatility versus the S&P 500.",
  "Your job: say what made the market care at that moment, from the news items and filings dated around the move.",
  "The point of the exercise: the moves caused by facts about THIS business (results, guidance, orders and backlog, margins, a contract, management, capital, a deal) show what the market watches on the company; the moves caused by the market at large say nothing about it.",
  "kind: fundamental = a fact about this company's business or capital caused it; macro = the market, rates, a war, a commodity price, a policy or sector-wide news moved it, not a fact of the company; technical = trading itself (index inclusion or removal, a share placement priced at a discount, a lock-up, a short squeeze) with no business fact; unknown = none of the items explains the move.",
  "Decide from what the items say, never from a word alone: a news item about oil can be a fundamental fact for a company whose contract changed, a results filing can be irrelevant if it came out after the move.",
  "fact: ONE plain sentence a reader understands without the items: what happened in the business (with the figure the item gives, in management's words when the item quotes them), or the macro or technical event. null when unknown.",
  "category: the one Driver Category the fact belongs to, exactly one of: " + DRIVER_CATEGORIES.join(", ") + "; null when unknown.",
  "cites: the ids of the items the fact rests on (only ids listed under that move). confidence: 0 to 1.",
  "No em dash. Answer with JSON only, no prose, no code fence:",
  '{"moves": [{"id": "M1", "kind": "fundamental" | "macro" | "technical" | "unknown", "fact": string | null, "category": string | null, "cites": ["I1"], "confidence": number}]}',
].join("\n");

const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

/** The prompt of one batch: each move with its own candidate items, short ids the answer cites. */
export function batchPrompt(symbol: string, name: string | null, moves: GoldPriceMove[], cands: Map<string, MoveCandidate[]>): { prompt: string; itemIds: Map<string, MoveCandidate>[] } {
  const itemIds: Map<string, MoveCandidate>[] = [];
  let n = 0;
  const blocks = moves.map((m, i) => {
    const ids = new Map<string, MoveCandidate>();
    const lines = (cands.get(m.id) ?? []).map((c) => {
      const id = `I${++n}`;
      ids.set(id, c);
      const summary = c.summary ? ` ${c.summary.replace(/\s+/g, " ").slice(0, 300)}` : "";
      return `  ${id} [${c.kind === "filing" ? "filing" : "news"}, ${c.at.toISOString().slice(0, 16).replace("T", " ")} UTC${c.publisher ? `, ${c.publisher}` : ""}] ${c.title}.${summary}`;
    });
    itemIds.push(ids);
    const span = m.startDay === m.endDay ? m.startDay : `${m.startDay} to ${m.endDay} (${m.days} sessions)`;
    return [`M${i + 1}: ${span}: the stock ${pct(m.returnPct)}, S&P 500 ${pct(m.benchReturn)}, abnormal ${pct(m.abnormal)} (${Math.abs(m.z).toFixed(1)} standard deviations).`, "Items dated around it:", ...lines].join("\n");
  });
  return { prompt: [`${symbol}${name ? ` (${name})` : ""}: ${moves.length} significant price moves.`, "", ...blocks].join("\n\n"), itemIds };
}

export type MoveVerdict = { kind: MoveCauseKind; fact: string | null; category: DriverCategory | null; cites: MoveCandidate[]; confidence: number };

/** Parses a batch answer: one verdict per move; unknown cited ids dropped; a move missing from the answer = an error. */
export function parseBatch(text: string, itemIds: Map<string, MoveCandidate>[]): MoveVerdict[] {
  const obj = JSON.parse(firstJsonObject(text)) as { moves?: unknown };
  if (!Array.isArray(obj.moves)) throw new Error(`move-causes: answer has no moves array: ${text.slice(0, 200)}`);
  const byId = new Map<string, Record<string, unknown>>();
  for (const x of obj.moves) if (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") byId.set((x as { id: string }).id, x as Record<string, unknown>);
  return itemIds.map((ids, i) => {
    const v = byId.get(`M${i + 1}`);
    if (!v) throw new Error(`move-causes: no verdict for M${i + 1}`);
    const kind = MOVE_CAUSE_KINDS.includes(v.kind as MoveCauseKind) ? (v.kind as MoveCauseKind) : null;
    if (!kind) throw new Error(`move-causes: kind "${String(v.kind)}" for M${i + 1} is not one of ${MOVE_CAUSE_KINDS.join(", ")}`);
    const cites = (Array.isArray(v.cites) ? v.cites : []).map((c) => ids.get(String(c))).filter((c): c is MoveCandidate => !!c);
    const category = DRIVER_CATEGORIES.includes(v.category as DriverCategory) ? (v.category as DriverCategory) : null;
    const fact = typeof v.fact === "string" && v.fact.trim() ? v.fact.trim().replace(/\s*[—–]\s*/g, ", ") : null;
    const confidence = Number(v.confidence);
    return { kind, fact, category: kind === "unknown" ? null : category, cites: [...new Set(cites)], confidence: confidence >= 0 && confidence <= 1 ? confidence : 0.5 };
  });
}

const citeOf = (c: MoveCandidate): MoveCite => ({ kind: c.kind, id: c.id, title: c.title, url: c.url, at: c.at.toISOString(), publisher: c.publisher, sources: c.sources });

export const moveCausesSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: PARALLEL,
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("move-causes: needs the database");
    if (!ctx.complete) throw new Error("move-causes: no LLM in the collector context (cli.ts sets ctx.complete)");
    const db = ctx.db;
    const { symbol, ids } = parseBatchSubject(subject);
    const all = await movesOfSymbol(db, symbol);
    const cands = await candidatesOf(db, symbol, all.filter((m) => ids.includes(m.id)));
    const moves = all.filter((m) => ids.includes(m.id) && (cands.get(m.id) ?? []).length > 0);
    if (moves.length === 0) return { request: { symbol, moves: ids.length }, httpStatus: null, error: "no move with items around it in this batch any more" };
    const [profile] = await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
    const { prompt, itemIds } = batchPrompt(symbol, profile?.name ?? null, moves, cands);
    const r = await ctx.complete({ system: MOVE_SYSTEM, prompt });
    const verdicts = parseBatch(r.text, itemIds);
    const rows = moves.map((m, i) => {
      const v = verdicts[i];
      return {
        subjectKind: MOVE_SUBJECT_KIND,
        subjectId: m.id,
        questionKey: moveKey(m.id, cands.get(m.id) ?? []),
        question: `${MOVE_QUESTION}: what caused the ${m.direction} move of ${symbol} from ${m.startDay} to ${m.endDay}`,
        verdict: v.kind,
        probability: v.confidence,
        citedSentence: null,
        reason: v.fact,
        model: r.model,
        raw: { batch: moves.length, category: v.category, cites: v.cites.map(citeOf) },
      };
    });
    await db.insert(silver.judgments).values(rows).onConflictDoNothing();
    return { request: { symbol, moves: moves.length }, httpStatus: null, payload: { judged: rows.length, model: r.model } };
  },
};

/** Rebuilds gold.price_move_causes for these tickers: each move's judgment on its current items, else unknown. */
export async function rebuildMoveCauses(db: Db, symbols: string[]): Promise<number> {
  let total = 0;
  for (const symbol of symbols) {
    const moves = await movesOfSymbol(db, symbol);
    const cands = await candidatesOf(db, symbol, moves);
    const stored = await storedJudgments(db, moves.map((m) => m.id));
    const rows = moves.map((m) => {
      const c = cands.get(m.id) ?? [];
      const j = c.length ? stored.get(`${m.id}\u0000${moveKey(m.id, c)}`) : undefined;
      const raw = (j?.raw ?? {}) as { category?: DriverCategory | null; cites?: MoveCite[] };
      return {
        id: m.id,
        symbol,
        kind: (j?.verdict as MoveCauseKind | undefined) ?? "unknown",
        fact: j?.reason ?? null,
        category: raw.category ?? null,
        cites: raw.cites ?? [],
        candidates: c.length,
        confidence: j?.probability ?? null,
        judgmentId: j?.id ?? null,
      };
    });
    // A move with items but no judgment yet (the call failed) stays out: it shows as "not judged yet", never as unknown.
    const ready = rows.filter((r) => r.judgmentId !== null || r.candidates === 0);
    await db.transaction(async (tx) => {
      await tx.delete(priceMoveCauses).where(eq(priceMoveCauses.symbol, symbol));
      for (let i = 0; i < ready.length; i += 500) await tx.insert(priceMoveCauses).values(ready.slice(i, i + 500));
    });
    total += ready.length;
  }
  return total;
}

export const moveCausesDim: Dimension = {
  name: MOVE_CAUSES_DIMENSION,
  description: "What caused each significant price move (market-reaction): a business fact (fundamental), the market at large (macro), trading itself (technical) or not found, from the news and filings dated 3 days before to 1 day after it, with the items it rests on. One judgment per move and set of items; no item = not found, no call.",
  sources: [moveCausesSource],
  subjects: pendingSubjects,
  promote: async (db): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await rebuildMoveCauses(db, await analysedSymbols(db)) } }),
};

/** A move with its cause, as the console and the analysis read it. */
export type MoveWithCause = GoldPriceMove & { cause: GoldPriceMoveCause | null };

/** Every significant move of a ticker with its cause, newest first. */
export async function movesWithCauses(db: Db, symbol: string): Promise<MoveWithCause[]> {
  const rows = await db.select().from(priceMoves).leftJoin(priceMoveCauses, eq(priceMoveCauses.id, priceMoves.id)).where(eq(priceMoves.symbol, symbol)).orderBy(desc(priceMoves.startDay));
  return rows.map((r) => ({ ...r.price_moves, cause: r.price_move_causes }));
}

/**
 * The read for the analysis (PR-D): the moves a business fact caused, newest first, each with its fact, Driver
 * Category and the items it rests on. What the market cared about on this company, with its sources.
 */
export async function fundamentalMovesOf(db: Db, symbol: string, since?: string): Promise<(GoldPriceMove & { cause: GoldPriceMoveCause })[]> {
  const rows = await db
    .select()
    .from(priceMoves)
    .innerJoin(priceMoveCauses, eq(priceMoveCauses.id, priceMoves.id))
    .where(and(eq(priceMoves.symbol, symbol), eq(priceMoveCauses.kind, "fundamental"), since ? gte(priceMoves.startDay, since) : undefined))
    .orderBy(desc(priceMoves.startDay));
  return rows.map((r) => ({ ...r.price_moves, cause: r.price_move_causes }));
}

/** One move and its cause (the `move:` item panel). */
export async function moveDetail(db: Db, id: string): Promise<MoveWithCause | null> {
  const [r] = await db.select().from(priceMoves).leftJoin(priceMoveCauses, eq(priceMoveCauses.id, priceMoves.id)).where(eq(priceMoves.id, id));
  return r ? { ...r.price_moves, cause: r.price_move_causes } : null;
}
