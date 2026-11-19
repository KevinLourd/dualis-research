import { and, eq, inArray } from "drizzle-orm";
import {
  CONFIDENCE_LEVELS,
  driverConfidence,
  MOVE_FITS,
  narratives,
  type ConfidenceLevel,
  type ConfidenceRow,
  type GoldNarrativeDriver,
  type MoveFit,
  type ThesisSide,
} from "@/db/schema/analysis";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { firstJsonObject } from "@/llm/judge";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { parseThesisId, SIDE } from "../analysis/sides";
import { driversOf } from "../evidence";
import { movesWithCauses, type MoveWithCause } from "../move-causes";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";

/**
 * Narrative Driver Temporal Confidence (Kevin 2026-11-19). A driver is found from the business moves the market made
 * (its origin: `gold.narrative_drivers.move_ids`). Was it a real driver, or one lucky story? This judge reads every
 * business move AFTER the first move it rests on (macro, trading and unexplained moves left out, Thierry 2026-11-17:
 * « if the market cared at that moment, that's a driver that matters ») and says, move by move, whether THIS reason
 * explains it (its subject changed and the price moved the way the story says), contradicts it (its subject changed
 * and the price did not care, or moved the other way) or is unrelated (another subject moved the price). Then how far
 * the driver can be trusted: strong, weak or noise. The judge decides, never a count rule. Only strong and weak
 * drivers go on to the Driver Signal (narrative-state). One call per thesis, stored once per drivers + moves.
 */

export const DRIVER_CONFIDENCE_DIMENSION = "driver-confidence";
export const CONFIDENCE_SUBJECT_KIND = "driver-confidence";
export const CONFIDENCE_QUESTION = "driver-confidence@v1";
/** The reason at the top of the panel: at most this many words (stated in the prompt). */
export const CONFIDENCE_REASON_WORDS = 20;

type Driver = Pick<GoldNarrativeDriver, "id" | "rank" | "category" | "title" | "text" | "moveIds">;
const business = (m: MoveWithCause) => m.cause?.kind === "fundamental";
const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** The moves a driver is tested on: every business move after the first move it rests on; all of them when it cites none. */
export function testedMoves(driver: Pick<Driver, "moveIds">, moves: MoveWithCause[]): MoveWithCause[] {
  const days = moves.filter((m) => driver.moveIds.includes(m.id)).map((m) => m.startDay).sort();
  const first = days[0];
  return moves.filter((m) => business(m) && (!first || m.startDay > first)).sort((a, b) => a.startDay.localeCompare(b.startDay));
}

/** The question key: the drivers' words, the moves they rest on, and each business move's judged cause. */
export function confidenceKey(drivers: Driver[], moves: MoveWithCause[]): string {
  const d = drivers.map((x) => `${x.id}|${x.category}|${x.title}|${x.text}|${x.moveIds.join(",")}`).join("\n");
  const m = moves.filter(business).map((x) => `${x.id}|${x.cause?.judgmentId ?? ""}`).join(",");
  return `${CONFIDENCE_QUESTION}:${fnv(`${d}\n${m}`)}`;
}

export const CONFIDENCE_SYSTEM = [
  "You are the equity research associate of a small-cap long/short analyst. He trusts a narrative driver only when the market has shown, again and again, that it trades the stock on that reason.",
  "A driver was found from the business moves of the past (its origin). You test it on every business move that came AFTER its origin: did this reason move the price again, the way its story says?",
  "For each move listed under a driver, fit = explains (the move's business fact is about THIS reason's subject and the price moved the way the story predicts), contradicts (this reason's subject changed and the price ignored it or moved the other way), or unrelated (the move was about another subject). Judge from the move's fact and its figure, never from the date alone.",
  "why = at most 12 words: the fact that makes it fit or not.",
  "level: strong = the market traded this reason again and again after its origin, the way the story says, with no clear contradiction: a reason a fundamental investor can rely on. weak = it explains some later moves, or too few later moves exist to test it, or one contradicts it. noise = no later move confirms it, or the moves contradict it: the market does not trade the stock on this reason.",
  `reason = ONE sentence of at most ${CONFIDENCE_REASON_WORDS} words for an equity research expert: why he can trust this driver, or not, naming how many moves it explains and the figure behind them.`,
  "No em dash, no en dash. Answer with JSON only, no prose, no code fence:",
  '{"drivers": [{"id": "D1", "level": "strong" | "weak" | "noise", "reason": string, "moves": [{"id": "M3", "fit": "explains" | "contradicts" | "unrelated", "why": string}]}]}',
].join("\n");

/** The prompt of one thesis: the business moves once (M1..), then each driver with its origin and the moves it is tested on. */
export function confidencePrompt(symbol: string, side: ThesisSide, narrative: string, drivers: Driver[], moves: MoveWithCause[]): { prompt: string; moveIds: Map<string, MoveWithCause>; tested: Map<string, MoveWithCause[]> } {
  const shown = moves.filter(business).sort((a, b) => a.startDay.localeCompare(b.startDay));
  const moveIds = new Map(shown.map((m, i) => [`M${i + 1}`, m]));
  const label = new Map(shown.map((m, i) => [m.id, `M${i + 1}`]));
  const others = moves.filter((m) => !business(m));
  const lines = shown.map((m) => {
    const c = m.cause!;
    const metric = c.metric ? ` Figure: ${c.metric.label} ${c.metric.from ? `${c.metric.from} to ` : ""}${c.metric.to}${c.metric.change ? ` (${c.metric.change})` : ""}, period ended ${c.metric.period}${c.lasting && c.lasting !== "n-a" ? `, ${c.lasting}` : ""}.` : "";
    return `${label.get(m.id)} ${m.startDay}: stock ${signedPct(m.returnPct)} (${Math.abs(m.z).toFixed(1)} standard deviations). ${c.category ?? "Uncategorised"}: ${c.fact ?? "no fact written"}.${metric}`;
  });
  const tested = new Map(drivers.map((d) => [d.id, testedMoves(d, moves)]));
  const blocks = drivers.map((d, i) => {
    const origin = d.moveIds.map((id) => label.get(id)).filter(Boolean);
    const t = tested.get(d.id)!;
    return [
      `D${i + 1}. ${d.title} (${d.category}): ${d.text}`,
      `   Origin: ${origin.length ? origin.join(", ") : "no business move cited: test it on every business move"}.`,
      `   Tested on: ${t.length ? t.map((m) => label.get(m.id)).join(", ") : "none: no business move came after its origin"}.`,
    ].join("\n");
  });
  const prompt = [
    `${symbol}, ${SIDE[side].label.toLowerCase()}: ${SIDE[side].story}. The narrative: ${narrative}`,
    "",
    `Business moves of the last years (beyond 2 standard deviations of the stock's own daily moves once the S&P 500 is taken out, caused by a fact about this company), oldest first:`,
    lines.length ? lines.join("\n") : "none.",
    `Left out: ${others.length} moves the market at large or trading caused, or with no cause found.`,
    "",
    "The drivers, each with the moves it rests on and the later moves to test it on (judge exactly those):",
    blocks.join("\n"),
  ].join("\n");
  return { prompt, moveIds, tested };
}

export type ConfidenceVerdict = { level: ConfidenceLevel; reason: string; rows: ConfidenceRow[] };

/** One verdict per driver; a driver missing, an unknown level or fit = an error; a move it was not tested on is dropped. */
export function parseConfidence(text: string, drivers: Driver[], moveIds: Map<string, MoveWithCause>, tested: Map<string, MoveWithCause[]>): ConfidenceVerdict[] {
  const obj = JSON.parse(firstJsonObject(text)) as { drivers?: unknown };
  if (!Array.isArray(obj.drivers)) throw new Error(`driver-confidence: answer has no drivers array: ${text.slice(0, 200)}`);
  const byId = new Map<string, Record<string, unknown>>();
  for (const x of obj.drivers) if (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") byId.set((x as { id: string }).id, x as Record<string, unknown>);
  return drivers.map((d, i) => {
    const v = byId.get(`D${i + 1}`);
    if (!v) throw new Error(`driver-confidence: no verdict for D${i + 1}`);
    if (!CONFIDENCE_LEVELS.includes(v.level as ConfidenceLevel)) throw new Error(`driver-confidence: level "${String(v.level)}" for D${i + 1} is not one of ${CONFIDENCE_LEVELS.join(", ")}`);
    if (typeof v.reason !== "string" || !v.reason.trim()) throw new Error(`driver-confidence: no reason for D${i + 1}`);
    const allowed = new Set((tested.get(d.id) ?? []).map((m) => m.id));
    const rows: ConfidenceRow[] = [];
    for (const r of Array.isArray(v.moves) ? v.moves : []) {
      const x = r as Record<string, unknown>;
      const m = moveIds.get(String(x.id));
      if (!m || !allowed.has(m.id) || rows.some((y) => y.moveId === m.id)) continue;
      if (!MOVE_FITS.includes(x.fit as MoveFit)) throw new Error(`driver-confidence: fit "${String(x.fit)}" for D${i + 1} ${String(x.id)} is not one of ${MOVE_FITS.join(", ")}`);
      rows.push({ moveId: m.id, day: m.startDay, returnPct: m.returnPct, fact: m.cause?.fact ?? null, metric: m.cause?.metric ?? null, fit: x.fit as MoveFit, why: stripDashes(typeof x.why === "string" ? x.why.trim() : "") });
    }
    return { level: v.level as ConfidenceLevel, reason: stripDashes(v.reason.trim()), rows: rows.sort((a, b) => a.day.localeCompare(b.day)) };
  });
}

export const driverConfidenceSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("driver-confidence: needs the database");
    if (!ctx.complete) throw new Error("driver-confidence: no LLM in the collector context (cli.ts sets ctx.complete)");
    const { symbol, side } = parseThesisId(subject);
    const d = await driversOf(ctx.db, symbol, side);
    if (!d) return { request: { symbol, side }, httpStatus: null, error: "no narrative or no driver for this thesis yet" };
    const moves = await movesWithCauses(ctx.db, symbol);
    const key = confidenceKey(d.drivers, moves);
    const { prompt, moveIds, tested } = confidencePrompt(symbol, side, d.narrative, d.drivers, moves);
    const r = await ctx.complete({ system: CONFIDENCE_SYSTEM, prompt });
    const verdicts = parseConfidence(r.text, d.drivers, moveIds, tested);
    const rows = d.drivers.map((drv, i) => ({
      subjectKind: CONFIDENCE_SUBJECT_KIND,
      subjectId: drv.id,
      questionKey: key,
      question: `${CONFIDENCE_QUESTION}: can the market be trusted to trade ${symbol} on « ${drv.title} »?`,
      verdict: verdicts[i].level,
      probability: 1,
      citedSentence: null,
      reason: verdicts[i].reason,
      model: r.model,
      raw: { rows: verdicts[i].rows, origin: drv.moveIds, tested: (tested.get(drv.id) ?? []).length },
    }));
    await ctx.db.insert(silver.judgments).values(rows).onConflictDoNothing();
    return { request: { symbol, side, version: d.version, drivers: d.drivers.length }, httpStatus: null, payload: { judged: rows.length, model: r.model } };
  },
};

/** The current key of each analysed thesis, and whether every one of its drivers already has a judgment on it. */
async function theses(db: Db): Promise<{ id: string; symbol: string; side: ThesisSide; drivers: Driver[]; key: string; moves: MoveWithCause[] }[]> {
  const symbols = new Set(await analysedSymbols(db));
  const rows = (await db.select({ id: narratives.id, symbol: narratives.symbol, side: narratives.side }).from(narratives)).filter((n) => symbols.has(n.symbol));
  const out = [];
  for (const t of rows) {
    const d = await driversOf(db, t.symbol, t.side);
    if (!d) continue;
    const moves = await movesWithCauses(db, t.symbol);
    out.push({ id: t.id, symbol: t.symbol, side: t.side, drivers: d.drivers, key: confidenceKey(d.drivers, moves), moves });
  }
  return out;
}

async function stored(db: Db, driverIds: string[], key: string) {
  if (driverIds.length === 0) return new Map<string, typeof silver.judgments.$inferSelect>();
  const rows = await db.select().from(silver.judgments).where(and(eq(silver.judgments.subjectKind, CONFIDENCE_SUBJECT_KIND), inArray(silver.judgments.subjectId, driverIds), eq(silver.judgments.questionKey, key)));
  return new Map(rows.map((j) => [j.subjectId, j]));
}

/** Theses (`<symbol>:<side>`) with a driver not judged on its current words and moves. */
async function subjects(db: Db): Promise<string[]> {
  const out: string[] = [];
  for (const t of await theses(db)) {
    const done = await stored(db, t.drivers.map((d) => d.id), t.key);
    if (t.drivers.some((d) => !done.has(d.id))) out.push(t.id);
  }
  return out;
}

/** Rebuilds gold.driver_confidence: every analysed driver's judgment on its current words and moves; a driver not judged yet stays out. */
export async function rebuildDriverConfidence(db: Db): Promise<number> {
  const all = await theses(db);
  const rows: (typeof driverConfidence.$inferInsert)[] = [];
  for (const t of all) {
    const done = await stored(db, t.drivers.map((d) => d.id), t.key);
    for (const d of t.drivers) {
      const j = done.get(d.id);
      if (!j) continue;
      const raw = j.raw as { rows: ConfidenceRow[]; origin: string[] };
      rows.push({
        id: d.id,
        symbol: t.symbol,
        side: t.side,
        level: j.verdict as ConfidenceLevel,
        reason: j.reason ?? "",
        originMoveIds: t.moves.filter((m) => raw.origin.includes(m.id)).map((m) => m.id).reverse(),
        rows: raw.rows,
        explained: raw.rows.filter((r) => r.fit === "explains").length,
        contradicted: raw.rows.filter((r) => r.fit === "contradicts").length,
        tested: raw.rows.length,
        asOf: j.createdAt,
        judgmentId: j.id,
      });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(driverConfidence);
    for (let i = 0; i < rows.length; i += 500) await tx.insert(driverConfidence).values(rows.slice(i, i + 500));
  });
  return rows.length;
}

/** The drivers a Driver Signal is asked for: the ones the market has shown it trades on (strong or weak confidence). */
export async function confidentDriverIds(db: Db, symbol: string): Promise<Set<string>> {
  return new Set((await testedDrivers(db, symbol)).filter((r) => r.level !== "noise").map((r) => r.id));
}

/** Every driver of the ticker whose confidence was judged, with its level. */
export async function testedDrivers(db: Db, symbol: string): Promise<{ id: string; level: ConfidenceLevel }[]> {
  return db.select({ id: driverConfidence.id, level: driverConfidence.level }).from(driverConfidence).where(eq(driverConfidence.symbol, symbol));
}

export const driverConfidenceDim: Dimension = {
  name: DRIVER_CONFIDENCE_DIMENSION,
  description: "How far each narrative driver can be trusted: did the market trade the stock on that reason again in the business moves that followed the ones it was found from? Strong, weak or noise, move by move.",
  sources: [driverConfidenceSource],
  subjects,
  promote: async (db): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await rebuildDriverConfidence(db) } }),
};
