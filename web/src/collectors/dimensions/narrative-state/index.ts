import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { evidence, fairValueHistory, NARRATIVE_TAGS, narratives, narrativeStates, parseTag, PRICED_IN, type GoldEvidence, type PricedIn, type Strength, type ThesisSide } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { firstJsonObject } from "@/llm/judge";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { parseThesisId, SIDE, thesisId } from "../analysis/sides";
import { driversOf, marketLine, verdictRank } from "../evidence";
import { majorUnit } from "../financials/derive";
import { reactionLine } from "../market-reaction/compute";
import { reactionsOf } from "../market-reaction";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";

/**
 * Narrative State, the top of the pyramid (Kevin 2026-11-06, rebuilt 2026-11-09). Per thesis (long / short):
 * 1) each DRIVER: the LLM reads its tagged news, newest first, each with what the price did since and the fair value
 *    then and now, and says where the reason stands now, since when, and how much of it the price already moved;
 * 2) the THESIS: from its drivers, today's price vs the fair value (base, low, high) and the price path, the LLM says
 *    where the story stands AND whether it signals now (a long can give a BUY, a short a SELL), since when, and why.
 * No rule decides the signal: the judge does, with every number in its context. One judgment per input.
 */

export const NARRATIVE_STATE_DIMENSION = "narrative-state";
/** v3 (2026-11-09): + a 4-5 word headline with its number (Kevin: « YTD margin 30% vs 2023 »). */
export const DRIVER_STATE_QUESTION = "driver-state@v3";
/** v1 (2026-11-09): the thesis tag AND its signal, decided by the judge. */
export const THESIS_STATE_QUESTION = "thesis-state@v1";

type StateVerdict = { id: string; driverId: string | null; verdict: string; probability: number; reason: string | null; judgmentId: string; evidenceIds: string[]; headline: string | null; since: string | null; pricedIn: PricedIn | null; signal: Strength | null; at: string };
export type NarrativeStatePayload = { side: ThesisSide; drivers: StateVerdict[]; thesis: StateVerdict };

type Answer = { tag: string; p: number; headline: string | null; since: string | null; pricedIn: PricedIn | null; signal: Strength | null; why: string | null };

const SYSTEM = "You judge where an equity story stands for a small-cap long/short analyst. Every number you need is in the text. Answer with JSON only, no prose, no code fence. Plain English, no em dash.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function parseAnswer(text: string, withSignal: boolean): Answer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (typeof o.tag !== "string" || !NARRATIVE_TAGS.includes(o.tag as never)) throw new Error(`narrative-state: tag "${String(o.tag)}" is not one of ${NARRATIVE_TAGS.join(", ")}`);
  if (typeof o.p !== "number" || !(o.p >= 0 && o.p <= 1)) throw new Error(`narrative-state: p "${String(o.p)}" is not a number in 0..1`);
  const signal = withSignal ? o.signal : null;
  if (withSignal && signal !== "strong" && signal !== "weak" && signal !== "none") throw new Error(`narrative-state: signal "${String(o.signal)}" is not strong, weak or none`);
  return {
    tag: o.tag,
    p: o.p,
    headline: typeof o.headline === "string" && o.headline.trim() ? stripDashes(o.headline.trim()) : null,
    since: typeof o.since === "string" && DAY.test(o.since) ? o.since : null,
    pricedIn: PRICED_IN.includes(o.pricedIn as PricedIn) ? (o.pricedIn as PricedIn) : null,
    signal: signal === null ? null : signal === "none" ? "noise" : (signal as Strength),
    why: typeof o.why === "string" && o.why.trim() ? stripDashes(o.why.trim()) : null,
  };
}

/** One stored judgment per (subject, question key): same input, never asked twice. */
async function judgeOnce(db: Db, complete: Complete, req: { subjectKind: string; subjectId: string; questionKey: string; question: string; prompt: string; withSignal: boolean }) {
  const key = and(eq(judgments.subjectKind, req.subjectKind), eq(judgments.subjectId, req.subjectId), eq(judgments.questionKey, req.questionKey));
  const [stored] = await db.select().from(judgments).where(key);
  if (stored) return stored;
  const r = await complete({ system: SYSTEM, prompt: req.prompt });
  const a = parseAnswer(r.text, req.withSignal);
  await db
    .insert(judgments)
    .values({ subjectKind: req.subjectKind, subjectId: req.subjectId, questionKey: req.questionKey, question: req.question, verdict: a.tag, probability: a.p, citedSentence: null, reason: a.why, model: r.model, raw: { headline: a.headline, since: a.since, pricedIn: a.pricedIn, signal: a.signal } })
    .onConflictDoNothing();
  const [row] = await db.select().from(judgments).where(key);
  return row;
}
const rawOf = (j: typeof judgments.$inferSelect) => j.raw as { headline?: string | null; since?: string | null; pricedIn?: PricedIn | null; signal?: Strength | null };

/** One driver's judged news, newest first, each with its tag, how much is priced in, and what the price did since. */
export function driverNewsLines(rows: GoldEvidence[], driverId: string, reactions: Map<string, Parameters<typeof reactionLine>[0]> = new Map()): { lines: string[]; ids: string[] } {
  const hits = rows
    .map((e) => ({ e, v: e.verdicts.find((x) => x.driverId === driverId) }))
    .filter((x): x is { e: GoldEvidence; v: NonNullable<typeof x.v> } => !!x.v && x.v.effect !== "noise")
    .sort((a, b) => b.e.eventAt.getTime() - a.e.eventAt.getTime());
  return {
    lines: hits.map(({ e, v }) => `${e.eventDay} [${v.effect}:${v.strength}${v.pricedIn ? `, priced in: ${v.pricedIn}` : ""}] ${e.headline}${v.why ? `. ${v.why}` : ""}\n    ${reactionLine(reactions.get(e.id))}`),
    ids: hits.map(({ e }) => e.id),
  };
}

/** The price path a thesis judge reads: 12 month-end closes, the last 10 closes, and every fair value change, oldest first. */
export async function pathLines(db: Db, symbol: string, now = new Date()): Promise<string> {
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [[q], bars, fvs] = await Promise.all([
    db.select({ currency: gold.quotes.currency }).from(gold.quotes).where(eq(gold.quotes.symbol, symbol)),
    db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(and(eq(gold.priceBars.symbol, symbol), gte(gold.priceBars.date, from))).orderBy(asc(gold.priceBars.date)),
    db.select().from(fairValueHistory).where(eq(fairValueHistory.symbol, symbol)).orderBy(asc(fairValueHistory.day)),
  ]);
  const px = (v: number) => {
    const m = majorUnit(v, q?.currency ?? null).price;
    return m >= 100 ? m.toFixed(0) : m.toFixed(2);
  };
  const months = new Map<string, number>();
  for (const b of bars) months.set(b.date.slice(0, 7), b.close);
  return [
    `Month-end closes: ${[...months].map(([m, c]) => `${m} ${px(c)}`).join("; ") || "none"}`,
    `Last closes: ${bars.slice(-10).map((b) => `${b.date} ${px(b.close)}`).join("; ") || "none"}`,
    `Fair value over time (base, range): ${fvs.map((f) => `${f.day} ${f.value >= 100 ? f.value.toFixed(0) : f.value.toFixed(2)}${f.low !== null && f.high !== null ? ` (${f.low.toFixed(2)} to ${f.high.toFixed(2)})` : ""}`).join("; ") || "only today's"}`,
  ].join("\n");
}

const today = () => new Date().toISOString().slice(0, 10);

export const narrativeStateSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("narrative-state: needs the database");
    if (!ctx.complete) throw new Error("narrative-state: no LLM in the collector context (cli.ts sets ctx.complete)");
    const { symbol, side } = parseThesisId(subject);
    const d = await driversOf(ctx.db, symbol, side);
    if (!d) return { request: { symbol, side }, httpStatus: null, error: "no narrative or no driver for this thesis yet" };
    const [rows, reactions] = await Promise.all([ctx.db.select().from(evidence).where(eq(evidence.symbol, symbol)), reactionsOf(ctx.db, symbol)]);
    const w = SIDE[side];
    const head = [`${symbol}, ${w.label.toLowerCase()}: ${w.story}.`, `The narrative: ${d.narrative}`, marketLine(d.market), `Today is ${today()}.`];

    const drivers: StateVerdict[] = [];
    for (const driver of d.drivers) {
      const { lines, ids } = driverNewsLines(rows, driver.id, reactions);
      const input = lines.length ? lines.join("\n") : "No news or filing of the last 12 months bears on this reason.";
      const question = [
        ...head,
        `ONE of the reasons the market holds it (${driver.category}): ${driver.title}. ${driver.text}`,
        "",
        "Below, every news item and filing that bears on this reason, newest first, each already tagged against it, with what the price did since and where it stood vs the fair value then and now.",
        `Where does this reason stand NOW? reversal = it is turning against the story (${w.reversal}); continuation = it holds and gets stronger; noise = nothing moves it.`,
        "Weigh them with their dates: recent beats old, several weak reversals in a row can make a strong one, one strong continuation after a reversal can cancel it.",
        "since = the day of the first news of the CURRENT state (null for noise). pricedIn = how much of that state the price has already moved (none, partly, fully), read from the price lines.",
        "headline = the current state in 4 to 5 words with its key number, like a chart label (e.g. \"YTD margin 30% vs 2023\", \"Sales growth slows to 4%\"); null for noise.",
      ].join("\n");
      const j = await judgeOnce(ctx.db, ctx.complete, {
        subjectKind: "driver-state",
        subjectId: driver.id,
        questionKey: `${DRIVER_STATE_QUESTION}:${d.version}:${fnv(`${question}\n${input}`)}`,
        question: `${DRIVER_STATE_QUESTION}: ${driver.title}`,
        prompt: `${question}\n\nNews:\n${input}\n\nJSON: {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "since": "<YYYY-MM-DD or null>", "pricedIn": <none | partly | fully>, "headline": "<4-5 words with the number, or null>", "why": "<one short sentence for a reader who has not seen the news>"}`,
        withSignal: false,
      });
      const raw = rawOf(j);
      drivers.push({ id: driver.id, driverId: driver.id, verdict: j.verdict, probability: j.probability, reason: j.reason, judgmentId: j.id, evidenceIds: ids, headline: raw.headline ?? null, since: raw.since ?? null, pricedIn: raw.pricedIn ?? null, signal: null, at: j.createdAt.toISOString() });
    }

    const input = d.drivers.map((x, i) => `${x.rank}. ${x.title} (${x.category}): ${drivers[i].verdict}${drivers[i].since ? ` since ${drivers[i].since}` : ""}${drivers[i].pricedIn ? `, priced in: ${drivers[i].pricedIn}` : ""}. ${drivers[i].reason ?? ""}`).join("\n");
    const path = await pathLines(ctx.db, symbol);
    const question = [
      ...head,
      "",
      "The reasons the market holds this story (Narrative Drivers, most important first) and where each one stands now:",
      input,
      "",
      "The price path and the fair value over time:",
      path,
      "",
      `1) tag: where does the WHOLE story stand? reversal = it is turning (${w.reversal}); continuation = it holds and gets stronger; noise = nothing moves it. Weigh the drivers by importance: the first one matters most.`,
      `2) signal: does this thesis give a ${w.signal} NOW? Only a turning story can, and only while the price has not yet made the move: weigh where the price sits vs the fair value base and its range ends, how much of the turn the price already moved since the news, and how recent the turn is. A turn the price has already fully priced in (the price reached the fair value) is no signal. strong = a clear, recent turn with most of the move still ahead; weak = an early or partial turn, or half priced in; none = no signal.`,
      "since = the day the current tag started (null for noise). pricedIn = how much of the turn the price has already moved.",
    ].join("\n");
    const t = await judgeOnce(ctx.db, ctx.complete, {
      subjectKind: "thesis-state",
      subjectId: thesisId(symbol, side),
      questionKey: `${THESIS_STATE_QUESTION}:${d.version}:${fnv(question)}`,
      question: `${THESIS_STATE_QUESTION}: ${symbol} ${side}`,
      prompt: `${question}\n\nJSON: {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "signal": <strong | weak | none>, "since": "<YYYY-MM-DD or null>", "pricedIn": <none | partly | fully>, "why": "<one or two short sentences: where the story stands and why it signals or not, with the price vs the fair value>"}`,
      withSignal: true,
    });
    const reversals = rows
      .flatMap((e) => e.verdicts.filter((v) => v.effect === "reversal" && d.drivers.some((x) => x.id === v.driverId)).map((v) => ({ e, v })))
      .sort((a, b) => verdictRank(a.v) - verdictRank(b.v) || b.e.eventAt.getTime() - a.e.eventAt.getTime());
    const raw = rawOf(t);
    const thesis: StateVerdict = { id: thesisId(symbol, side), driverId: null, verdict: t.verdict, probability: t.probability, reason: t.reason, judgmentId: t.id, evidenceIds: [...new Set(reversals.map((x) => x.e.id))], headline: null, since: raw.since ?? null, pricedIn: raw.pricedIn ?? null, signal: raw.signal ?? "noise", at: t.createdAt.toISOString() };
    const payload: NarrativeStatePayload = { side, drivers, thesis };
    return { request: { symbol, side, version: d.version }, httpStatus: null, payload };
  },
};

/** Every current thesis (`<symbol>:<side>`) of the analysed tickers. */
async function subjects(db: Db): Promise<string[]> {
  const symbols = new Set(await analysedSymbols(db));
  return (await db.select({ id: narratives.id, symbol: narratives.symbol }).from(narratives)).filter((n) => symbols.has(n.symbol)).map((n) => n.id);
}

export const narrativeStateDim: Dimension = {
  name: NARRATIVE_STATE_DIMENSION,
  description: "Per thesis: where each Narrative Driver stands given its dated news and what the price did since, then where the whole story stands and whether it signals now given the fair value (base, low, high) and the price path. The judge decides the signal.",
  sources: [narrativeStateSource],
  subjects,
  promote: async (db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await promoteNarrativeStates(db, fetches) } }),
};

/** gold.narrative_states from this run's latest answer per thesis (the judgments themselves live in silver.judgments). */
export async function promoteNarrativeStates(db: Db, fetches: BronzeFetch[]): Promise<number> {
  const latest = new Map<string, NarrativeStatePayload>();
  for (const f of fetches.filter((x) => !x.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f.payload as NarrativeStatePayload);
  const rows: (typeof narrativeStates.$inferInsert)[] = [];
  for (const [subject, p] of latest) {
    const { symbol, side } = parseThesisId(subject);
    for (const [level, v] of [...p.drivers.map((x) => ["driver", x] as const), ["thesis", p.thesis] as const]) {
      const t = parseTag(v.verdict);
      rows.push({ id: v.id, symbol, side, level, driverId: v.driverId, effect: t.effect, strength: t.strength, why: v.reason, probability: v.probability, evidenceIds: v.evidenceIds, headline: v.headline ?? null, since: v.since, pricedIn: v.pricedIn, signal: v.signal, judgmentId: v.judgmentId, asOf: new Date(v.at) });
    }
  }
  // Every analysed ticker's states are rebuilt: a thesis that no longer exists (the price left the range) drops out.
  const current = new Set((await db.select({ id: narratives.id }).from(narratives)).map((n) => n.id));
  const symbols = [...new Set([...latest.keys()].map((k) => parseThesisId(k).symbol))];
  await db.transaction(async (tx) => {
    if (symbols.length) await tx.delete(narrativeStates).where(inArray(narrativeStates.symbol, symbols));
    const keep = rows.filter((r) => current.has(thesisId(r.symbol, r.side)));
    if (keep.length) await tx.insert(narrativeStates).values(keep);
  });
  return rows.length;
}
