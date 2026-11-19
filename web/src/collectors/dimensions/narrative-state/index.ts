import { and, asc, desc, eq, gte, inArray, like } from "drizzle-orm";
import { figuresText, table } from "../analysis/facts";
import { seriesCatalog, type StoredSeries } from "../analysis/series";
import { quoteStamp } from "../intraday-price";
import type { BronzeFetch } from "@/db/schema/bronze";
import { DURABILITIES, evidence, exhibits, fairValueHistory, NARRATIVE_TAGS, narratives, narrativeStates, parseTag, priceMoveCauses, priceMoves, PRICED_IN, type DocCitation, type Durability, type GoldEvidence, type Magnitude, type PricedIn, type Strength, type ThesisSide } from "@/db/schema/analysis";
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
import { confidentDriverIds } from "../driver-confidence";
import { resultsPages, verifyQuote, type ResultsPage } from "../filing-documents/read";

/**
 * Narrative State, the top of the pyramid (Kevin 2026-11-06, rebuilt 2026-11-09). Per thesis (long / short):
 * 1) each DRIVER: the LLM reads its tagged news, newest first, each with what the price did since and the fair value
 *    then and now, and says where the reason stands now, since when, and how much of it the price already moved;
 * 2) the THESIS: from its drivers, today's price vs the fair value (base, low, high) and the price path, the LLM says
 *    where the story stands AND whether it signals now (a long can give a BUY, a short a SELL), since when, and why.
 * No rule decides the signal: the judge does, with every number in its context. One judgment per input.
 * Stability (Kevin 2026-11-12, « on est sur du fondamental »): the key holds the facts (news verdicts, figures, the
 * thesis) and the price and fair value in 5% buckets only, never today's date or the 5-minute price, so a price tick
 * never re-asks; and every judge reads its own last reading (tag, signal, why, when), outside the key.
 */

export const NARRATIVE_STATE_DIMENSION = "narrative-state";
/**
 * v3 (2026-11-09): + a 4-5 word headline with its number (Kevin: « YTD margin 30% vs 2023 »). v4 (2026-11-12): + its
 * last reading, key on facts + 5% buckets. v5 (INFLECTION-1117, Thierry): + durability (structural / temporary), magnitude,
 * the one-sentence reason, the full explanation quoting management from the company's documents, the moves behind it.
 * v6 (eval 2026-11-17: reasons ran to 40 words, a consensus driver sized on net debt): reason at most 20 words, magnitude = this reason's figure.
 * v7 (PR-E, prod 2026-11-17: Kyungbang's holder, profit and consensus drivers all read the company's debt paydown): the
 * judge reads the driver's OWN figures first (its exhibits' series), the company's other figures as context only, and
 * judges this reason alone; magnitude names its series, kept only when it is one of the driver's (`scopeMagnitude`).
 * v8 (Kevin 2026-11-18: « résumée très clairement et le plus concisément possible en haut »; the judge wrote ~30 words
 * against a 20-word instruction): the judge no longer writes the reason; a second call on its finished judgment does
 * (`writeReason`, at most 15 words), never a validator or a retry.
 * v9 (2026-11-18: a reason said « temporary » beside a Structural badge): one source per fact, the reason states the
 * business cause and the figure only; durability and size stay the judge's fields (badges), never in the sentence.
 */
export const DRIVER_STATE_QUESTION = "driver-state@v9";
/** The reason at the top of the driver panel: at most this many words (stated in `writeReason`'s prompt). */
export const REASON_WORDS = 15;
/** v1 (2026-11-09): the thesis tag AND its signal, decided by the judge. v2 (2026-11-12): + its last reading, key on facts + 5% buckets. v3: reads each driver's durability and magnitude. */
export const THESIS_STATE_QUESTION = "thesis-state@v4";

/** The company documents a driver judge reads: filed in the last 12 months, the newest few, their best results pages. */
export const DOC_MONTHS = 12;
export const DOCS_READ = 4;
export const PAGES_PER_DOC = 2;
/** A page is cut to this many characters in the prompt (the quote is still checked against the whole stored page). */
export const PAGE_PROMPT_CHARS = 3_500;

/** Price and fair value enter a judgment key in 5% buckets (Kevin 2026-11-12): a tick never re-asks, a real move does. */
const STEP = Math.log(1.05);
const bucket = (x: number | null) => (x !== null && x > 0 ? Math.round(Math.log(x) / STEP) : "none");
export function marketKey(m: { price: number; fv: { value: number; low: number | null; high: number | null } } | null): string {
  return m ? `price:${bucket(m.price)} fv:${bucket(m.fv.value)} low:${bucket(m.fv.low)} high:${bucket(m.fv.high)}` : "none";
}

type StateVerdict = {
  id: string;
  driverId: string | null;
  verdict: string;
  probability: number;
  reason: string | null;
  /** null when no call was made (no driver the market trades on). */
  judgmentId: string | null;
  evidenceIds: string[];
  headline: string | null;
  since: string | null;
  pricedIn: PricedIn | null;
  signal: Strength | null;
  at: string;
  /** Driver level (v5): Structural / Temporary, size, the one-sentence conclusion, the full why and its quotes. */
  durability?: Durability | null;
  magnitude?: Magnitude | null;
  conclusion?: string | null;
  explanation?: string | null;
  citations?: DocCitation[];
};
export type NarrativeStatePayload = { side: ThesisSide; drivers: StateVerdict[]; thesis: StateVerdict };

/** A quote as the judge cites it: the page label it read (`D1`), the page number, the words. */
export type RawCitation = { doc: string; page: number; quote: string };
type Answer = {
  tag: string;
  p: number;
  headline: string | null;
  since: string | null;
  pricedIn: PricedIn | null;
  signal: Strength | null;
  why: string | null;
  durability: Durability | null;
  magnitude: Magnitude | null;
  reason: string | null;
  explanation: string | null;
  citations: RawCitation[];
};

const SYSTEM = [
  "You judge where an equity story stands for a small-cap long/short analyst. Every number you need is in the text.",
  "Read it as a fundamental investor does: what the market believes about a business moves with facts about the business, over weeks and months.",
  "Answer with JSON only, no prose, no code fence. Plain English, no em dash.",
].join(" ");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function parseAnswer(text: string, withSignal: boolean): Answer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (typeof o.tag !== "string" || !NARRATIVE_TAGS.includes(o.tag as never)) throw new Error(`narrative-state: tag "${String(o.tag)}" is not one of ${NARRATIVE_TAGS.join(", ")}`);
  if (typeof o.p !== "number" || !(o.p >= 0 && o.p <= 1)) throw new Error(`narrative-state: p "${String(o.p)}" is not a number in 0..1`);
  const signal = withSignal ? o.signal : null;
  if (withSignal && signal !== "strong" && signal !== "weak" && signal !== "none") throw new Error(`narrative-state: signal "${String(o.signal)}" is not strong, weak or none`);
  const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "null" ? stripDashes(v.trim()) : null);
  const m = o.magnitude && typeof o.magnitude === "object" ? (o.magnitude as Record<string, unknown>) : null;
  const reversal = o.tag.startsWith("reversal");
  return {
    tag: o.tag,
    p: o.p,
    headline: str(o.headline),
    since: typeof o.since === "string" && DAY.test(o.since) ? o.since : null,
    pricedIn: PRICED_IN.includes(o.pricedIn as PricedIn) ? (o.pricedIn as PricedIn) : null,
    signal: signal === null ? null : signal === "none" ? "noise" : (signal as Strength),
    why: str(o.why),
    // Durability only says something about a turn: nothing turns = n-a, whatever the answer wrote.
    durability: o.durability === undefined ? null : reversal && DURABILITIES.includes(o.durability as Durability) ? (o.durability as Durability) : "n-a",
    magnitude: m && str(m.figure) ? { figure: str(m.figure)!, series: str(m.series), from: str(m.from), to: str(m.to), change: str(m.change), size: m.size === "material" ? "material" : "small" } : null,
    reason: str(o.reason),
    explanation: str(o.explanation),
    citations: (Array.isArray(o.citations) ? (o.citations as Record<string, unknown>[]) : [])
      .map((c) => ({ doc: String(c?.doc ?? "").trim(), page: Number(c?.page), quote: typeof c?.quote === "string" ? c.quote.trim() : "" }))
      .filter((c) => c.doc && Number.isInteger(c.page) && c.page >= 1 && c.quote.length >= 8),
  };
}

/** The pages a driver judge reads, labelled `D1`, `D2`... by document, newest first. */
export type ReadPages = { label: string; page: ResultsPage }[];

/**
 * Deterministic cleanup after the judge (never a retry): a citation stays only when its label names a document the
 * judge was shown AND its quote is printed on the page it cites (`verifyQuote`, PR-B).
 */
export async function keepPrintedCitations(db: Db, cited: RawCitation[], pages: ReadPages): Promise<DocCitation[]> {
  const docs = new Map(pages.map((p) => [p.label, p.page.document]));
  const out: DocCitation[] = [];
  for (const c of cited) {
    const doc = docs.get(c.doc);
    if (!doc || c.page > doc.pageCount) continue;
    if (!(await verifyQuote(db, doc.id, c.page, c.quote))) continue;
    if (out.some((x) => x.documentId === doc.id && x.page === c.page && x.quote === c.quote)) continue;
    out.push({ documentId: doc.id, page: c.page, quote: c.quote, title: doc.title, filedAt: doc.filedAt.toISOString().slice(0, 10) });
  }
  return out;
}

/** The newest documents of the last 12 months and their results pages, labelled for the prompt. */
export async function pagesToRead(db: Db, symbol: string, now = new Date()): Promise<ReadPages> {
  const from = new Date(now.getTime() - DOC_MONTHS * 30.5 * 86_400_000);
  const pages = await resultsPages(db, symbol, { from, to: now }, PAGES_PER_DOC);
  const ids = [...new Set(pages.map((p) => p.document.id))].slice(0, DOCS_READ);
  return pages.filter((p) => ids.includes(p.document.id)).map((page) => ({ label: `D${ids.indexOf(page.document.id) + 1}`, page }));
}

/** The pages as the prompt shows them: `[D1 page 12] <title> (filed 2026-08-14)` then the page text. */
export function pagesText(pages: ReadPages): string {
  if (pages.length === 0) return "No company document of the last 12 months is stored: say what the news and figures show, and cite nothing.";
  return pages.map(({ label, page: p }) => `[${label} page ${p.page}] ${p.document.title} (filed ${p.document.filedAt.toISOString().slice(0, 10)})\n${p.text.slice(0, PAGE_PROMPT_CHARS)}`).join("\n\n");
}

const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
/** The significant moves a driver rests on (analysis `moveIds`), newest first, with their business cause. */
export async function driverMoveLines(db: Db, moveIds: string[]): Promise<string[]> {
  if (moveIds.length === 0) return [];
  const rows = await db.select().from(priceMoves).leftJoin(priceMoveCauses, eq(priceMoveCauses.id, priceMoves.id)).where(inArray(priceMoves.id, moveIds)).orderBy(desc(priceMoves.startDay));
  return rows.map(({ price_moves: m, price_move_causes: c }) => `${m.startDay}: stock ${pct(m.returnPct)}, S&P 500 ${pct(m.benchReturn)}. ${c?.fact ?? "cause not judged"}`);
}

/** A driver's chart as its judge sees it: the title and the stored series keys it draws (gold.exhibits, or an analysis answer in a replay). */
export type DriverExhibit = { title: string; series: string[] };

/** Series families whose keys name the same figure at another period length (`line:revenue`, `qline:revenue`...). */
const FAMILIES = [["line", "hline", "qline", "metric", "qmetric"], ["consensus", "qconsensus", "actual", "qactual"]];
/**
 * The stored series that belong to a driver: its exhibits' keys, the same figure at the other period lengths, and the
 * figure's derived ratios (`revenue` -> `revenue-growth`, `net-debt` -> `net-debt-to-ebitda`). The share price is the
 * market's reaction, never the business figure a reason is measured on: left out.
 */
export function driverSeriesKeys(catalog: Map<string, StoredSeries>, exhibitsOf: DriverExhibit[]): string[] {
  const out = new Set<string>();
  for (const key of exhibitsOf.flatMap((e) => e.series)) {
    const i = key.indexOf(":");
    if (i < 0) continue;
    const [prefix, name] = [key.slice(0, i), key.slice(i + 1)];
    const family = FAMILIES.find((f) => f.includes(prefix));
    if (!family) continue;
    for (const k of catalog.keys()) {
      const j = k.indexOf(":");
      const [p, n] = [k.slice(0, j), k.slice(j + 1)];
      if (family.includes(p) && (n === name || n.startsWith(`${name}-`))) out.add(k);
    }
  }
  return [...out].sort();
}

/** A driver's own figures for its judge: one table per period length, the latest 6 periods, each row with its key. */
export function driverFiguresText(catalog: Map<string, StoredSeries>, keys: string[], exhibitsOf: DriverExhibit[]): string | null {
  if (keys.length === 0) return null;
  const byType = new Map<string, string[]>();
  for (const k of keys) {
    const t = catalog.get(k)!.periodType;
    byType.set(t, [...(byType.get(t) ?? []), k]);
  }
  const charts = exhibitsOf.map((e) => e.title).join("; ");
  return [`Its charts: ${charts}.`, ...[...byType].map(([t, ks]) => `${{ year: "Fiscal years", half: "Half years", quarter: "Quarters", month: "Months" }[t as StoredSeries["periodType"]]}:\n${table(catalog, ks, 6)}`)].join("\n");
}

/**
 * Deterministic cleanup after the judge (never a retry): a magnitude stays only when it is read on one of the driver's
 * own series. A driver with none gets no magnitude; a figure from another part of the business belongs to its own driver.
 */
export function scopeMagnitude(m: Magnitude | null, keys: Set<string>): Magnitude | null {
  return m && m.series && keys.has(m.series) ? m : null;
}

/** Where a stored judgment lives: the database in a run, a map in a dry replay (the eval reads prod, never writes). */
export type JudgmentStore = {
  get(subjectKind: string, subjectId: string, questionKey: string): Promise<typeof judgments.$inferSelect | undefined>;
  put(row: typeof judgments.$inferInsert): Promise<typeof judgments.$inferSelect>;
};
export const dbStore = (db: Db): JudgmentStore => {
  const where = (k: string, i: string, q: string) => and(eq(judgments.subjectKind, k), eq(judgments.subjectId, i), eq(judgments.questionKey, q));
  return {
    get: async (k, i, q) => (await db.select().from(judgments).where(where(k, i, q)))[0],
    put: async (row) => {
      await db.insert(judgments).values(row).onConflictDoNothing();
      return (await db.select().from(judgments).where(where(row.subjectKind, row.subjectId, row.questionKey)))[0];
    },
  };
};
export const memoryStore = (): JudgmentStore => {
  const rows = new Map<string, typeof judgments.$inferSelect>();
  return {
    get: async (k, i, q) => rows.get(`${k}|${i}|${q}`),
    put: async (row) => {
      const full = { id: crypto.randomUUID(), createdAt: new Date(), citedSentence: null, ...row } as typeof judgments.$inferSelect;
      rows.set(`${row.subjectKind}|${row.subjectId}|${row.questionKey}`, full);
      return full;
    },
  };
};

const REASON_SYSTEM = "You write the one line at the top of an equity research panel. Answer with JSON only, no prose, no code fence. Plain English, no em dash.";
/**
 * The prompt of the reason writer: the finished judgment of one driver in, its top line out. One source per fact
 * (2026-11-18: a reason said « temporary » beside a Structural badge): durability and size are the judge's fields, shown
 * as badges beside the line, so the writer never sees nor writes them; it states the business cause and the figure.
 */
export function reasonPrompt(a: Pick<Answer, "tag" | "magnitude" | "headline" | "explanation" | "why">): string {
  const m = a.magnitude;
  return [
    "A judge has finished reading where one reason the market holds about a company stands now. Its judgment:",
    `State: ${a.tag}.`,
    m ? `Figure: ${m.figure}${m.from && m.to ? ` ${m.from} to ${m.to}` : ""}${m.change ? ` (${m.change})` : ""}.` : "Figure: none.",
    a.headline ? `Headline: ${a.headline}` : null,
    `Explanation: ${a.explanation ?? a.why ?? ""}`,
    "",
    `Write the reason a reader sees first, summarised as clearly and as briefly as possible: ONE sentence of at most ${REASON_WORDS} words, subject verb complement.`,
    "It states the business cause and the figure it moved (why it moved, never only that it moved); when nothing turned, it says so about this subject.",
    "Whether the change lasts and how big it is are shown beside your line as their own badges, decided by the judge: never write them (no structural, temporary, lasting, one-off, material, small, big), so the page never says it twice or two ways.",
    'Example: "Cotton cost relief lifted Q3 margin to 16.7%."',
    'JSON: {"reason": "<the sentence>"}',
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** The second call on a finished driver judgment: its top-line reason. Its answer is taken as written (dashes stripped). */
export async function writeReason(complete: Complete, a: Pick<Answer, "tag" | "magnitude" | "headline" | "explanation" | "why">): Promise<string | null> {
  const r = await complete({ system: REASON_SYSTEM, prompt: reasonPrompt(a) });
  const o = JSON.parse(firstJsonObject(r.text)) as { reason?: unknown };
  return typeof o.reason === "string" && o.reason.trim() ? stripDashes(o.reason.trim()) : null;
}

/** One stored judgment per (subject, question key): same input, never asked twice. `pages` = the documents the judge read (its citations are checked against them before storing). */
async function judgeOnce(store: JudgmentStore, db: Db, complete: Complete, req: { subjectKind: string; subjectId: string; questionKey: string; question: string; prompt: string; withSignal: boolean; pages?: ReadPages; magnitudeKeys?: Set<string>; writeReason?: boolean }) {
  const stored = await store.get(req.subjectKind, req.subjectId, req.questionKey);
  if (stored) return stored;
  const r = await complete({ system: SYSTEM, prompt: req.prompt });
  const a = parseAnswer(r.text, req.withSignal);
  const citations = req.pages ? await keepPrintedCitations(db, a.citations, req.pages) : [];
  const magnitude = req.magnitudeKeys ? scopeMagnitude(a.magnitude, req.magnitudeKeys) : a.magnitude;
  // A driver's reason is written by a second call on the finished judgment (a meta-task on the text), never by the judge.
  const reason = req.writeReason ? await writeReason(complete, { ...a, magnitude }) : a.reason;
  return store.put({
    subjectKind: req.subjectKind,
    subjectId: req.subjectId,
    questionKey: req.questionKey,
    question: req.question,
    verdict: a.tag,
    probability: a.p,
    citedSentence: null,
    reason: a.why,
    model: r.model,
    raw: { headline: a.headline, since: a.since, pricedIn: a.pricedIn, signal: a.signal, durability: a.durability, magnitude, ...(a.magnitude && !magnitude ? { magnitudeDropped: a.magnitude } : {}), reason, explanation: a.explanation, citations, citationsDropped: a.citations.length - citations.length },
  });
}
type Raw = { headline?: string | null; since?: string | null; pricedIn?: PricedIn | null; signal?: Strength | null; durability?: Durability | null; magnitude?: Magnitude | null; reason?: string | null; explanation?: string | null; citations?: DocCitation[] };
const rawOf = (j: typeof judgments.$inferSelect) => (j.raw ?? {}) as Raw;

/** The judge's own last reading of this subject (any version of the question), as one line for its prompt, or null. */
/** `sameVersion`: only a reading made under this version of the question (a version that changes what the judge reads must not be anchored on the old one). */
export async function lastReading(db: Db, subjectKind: string, subjectId: string, question: string, sameVersion = false): Promise<string | null> {
  const [j] = await db
    .select({ verdict: judgments.verdict, reason: judgments.reason, raw: judgments.raw, createdAt: judgments.createdAt })
    .from(judgments)
    .where(and(eq(judgments.subjectKind, subjectKind), eq(judgments.subjectId, subjectId), like(judgments.questionKey, sameVersion ? `${question}:%` : `${question.split("@")[0]}@%`)))
    .orderBy(desc(judgments.createdAt))
    .limit(1);
  if (!j) return null;
  const r = j.raw as Raw | null;
  const signal = r?.signal === undefined ? "" : `, signal ${r.signal === null || r.signal === "noise" ? "none" : r.signal}`;
  const lasting = r?.durability && r.durability !== "n-a" ? `, ${r.durability}` : "";
  return `Your last reading, on ${j.createdAt.toISOString().slice(0, 10)}: ${j.verdict}${lasting}${signal}${r?.since ? ` since ${r.since}` : ""}${r?.pricedIn ? `, priced in: ${r.pricedIn}` : ""}. ${r?.reason ?? j.reason ?? ""}`.trim();
}

/** One driver's judged news, newest first, each with its tag, how much is priced in, and what the price did since. */
export function driverNewsLines(rows: GoldEvidence[], driverId: string, reactions: Map<string, Parameters<typeof reactionLine>[0]> = new Map()): { lines: string[]; ids: string[]; key: string } {
  const hits = rows
    .map((e) => ({ e, v: e.verdicts.find((x) => x.driverId === driverId) }))
    .filter((x): x is { e: GoldEvidence; v: NonNullable<typeof x.v> } => !!x.v && x.v.effect !== "noise")
    .sort((a, b) => b.e.eventAt.getTime() - a.e.eventAt.getTime());
  return {
    lines: hits.map(({ e, v }) => `${e.eventDay} [${v.effect}:${v.strength}${v.pricedIn ? `, priced in: ${v.pricedIn}` : ""}] ${e.headline}${v.why ? `. ${v.why}` : ""}\n    ${reactionLine(reactions.get(e.id))}`),
    ids: hits.map(({ e }) => e.id),
    // The facts behind the lines (each item's verdict), never the price-now part of its reaction line.
    key: hits.map(({ e, v }) => `${e.id}:${v.judgmentId}`).join(","),
  };
}

/** The price path a thesis judge reads: 12 month-end closes, the last 10 closes, the latest price (5-minute when the market is open), and every fair value change, oldest first. */
export async function pathLines(db: Db, symbol: string, now = new Date()): Promise<string> {
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [[q], bars, fvs] = await Promise.all([
    db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol)),
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
    q ? `Latest price: ${px(q.close)} (${quoteStamp(q)})` : "Latest price: none",
    `Fair value over time (base, range): ${fvs.map((f) => `${f.day} ${f.value >= 100 ? f.value.toFixed(0) : f.value.toFixed(2)}${f.low !== null && f.high !== null ? ` (${f.low.toFixed(2)} to ${f.high.toFixed(2)})` : ""}`).join("; ") || "only today's"}`,
  ].join("\n");
}

const today = () => new Date().toISOString().slice(0, 10);

/** What a driver of this thesis looks like to the judges (gold.narrative_drivers, or an analysis answer in a replay). */
export type JudgedDriver = { id: string; rank: number; category: string; title: string; text: string; moveIds: string[]; exhibits?: DriverExhibit[] };
export type ThesisInput = { side: ThesisSide; version: string; narrative: string; market: Parameters<typeof marketLine>[0]; drivers: JudgedDriver[] };

/**
 * The game every driver judge plays (Thierry 2026-11-17, private docs/meeting-2026-11-17.md), stated as the principle,
 * never as cases: what counts as a turn, when it lasts, when it is big enough.
 */
const DRIVER_GAME = [
  "What a turn is: a change in the BUSINESS itself (its earnings power: demand, orders and backlog, prices, margins, costs, capital), never a move of the market at large, rates, a commodity price or trading.",
  "durability: structural = the change lasts as the market projects earnings forward, the business running with no extraordinary circumstance (normalized earnings), whatever the horizon; temporary = it does not: a one-off contract, a volatile input price, demand pulled forward, over-earning after cutting costs the business needs, a one-off charge. n-a when nothing turns.",
  "Strength: strong needs a structural change AND a material one (big enough to move the stock: a backlog that doubles, never a 3% difference); a temporary change is weak at most; a small one is weak at most; a macro or trading move is noise.",
  "Leverage is read against earnings (net debt / EBITDA, interest cover), never against the market cap.",
].join(" ");

/**
 * The scope of one driver judge (PR-E, Kyungbang 2026-11-17: the holder, profit and consensus drivers all read the debt
 * paydown): the market holds several reasons, each has its own judge, so this one judges its own subject only.
 */
const DRIVER_SCOPE = [
  "You judge THIS reason only. The market holds the story for several reasons and each one has its own judge: has what the market believes on THIS point turned?",
  "A change in another part of the business (debt paid down under a reason about profits, store sales under a reason about analyst coverage) is judged on the reason about it, never here.",
  "When this reason's own subject did not move, it reads continuation or noise, and the explanation says so about this subject, whatever else improved or worsened.",
].join(" ");

/**
 * Judges one thesis: each driver (its news, the moves it rests on, the company's own documents), then the thesis.
 * `store` keeps the judgments (the database in a run, memory in a dry replay).
 */
export async function judgeThesis(db: Db, complete: Complete, store: JudgmentStore, symbol: string, d: ThesisInput): Promise<NarrativeStatePayload> {
  const side = d.side;
  const [rows, reactions, pages, catalog] = await Promise.all([db.select().from(evidence).where(eq(evidence.symbol, symbol)), reactionsOf(db, symbol), pagesToRead(db, symbol), seriesCatalog(db, symbol)]);
  const w = SIDE[side];
  // The reported figures: a reason about the numbers is judged on the numbers too, never on headlines alone. A driver
  // judge reads its own figures first and these as context. The thesis judge never reads them (v4, Kevin 2026-11-18:
  // Kyungbang read « Weak inflection » on a debt paydown no driver was about, every driver grey under it): the story
  // stands on its drivers, so its state comes from their states only.
  const figures = await figuresText(db, symbol);
  const story = [`${symbol}, ${w.label.toLowerCase()}: ${w.story}.`, `The narrative: ${d.narrative}`, marketLine(d.market), `Today is ${today()}.`];
  // What the key holds: the thesis, the figures, the documents read, the price and fair value in 5% buckets.
  const docsKey = pages.map((p) => `${p.page.document.id}:${p.page.page}`).join(",");
  const base = `${d.version}|${fnv(figures)}|${marketKey(d.market)}|${fnv(docsKey)}`;
  const documents = pagesText(pages);

  const drivers: StateVerdict[] = [];
  for (const driver of d.drivers) {
    const { lines, ids, key } = driverNewsLines(rows, driver.id, reactions);
    const input = lines.length ? lines.join("\n") : "No news or filing of the last 12 months bears on this reason.";
    const moves = await driverMoveLines(db, driver.moveIds);
    const last = await lastReading(db, "driver-state", driver.id, DRIVER_STATE_QUESTION);
    const exhibitsOf = driver.exhibits ?? [];
    const ownKeys = driverSeriesKeys(catalog, exhibitsOf);
    const own = driverFiguresText(catalog, ownKeys, exhibitsOf);
    const question = [
      ...story,
      "",
      `ONE of the reasons the market holds it (${driver.category}): ${driver.title}. ${driver.text}`,
      own ? `This reason's own figures (what its state is measured on, each row with its key in brackets):\n${own}` : "This reason has no reported figure of its own: judge it on its news, its moves and the documents, and give no magnitude.",
      moves.length ? `The significant price moves the market made on this reason (what made it a driver):\n${moves.join("\n")}` : "No significant price move is tied to this reason.",
      "",
      "Below, every news item and filing that bears on this reason, newest first, each already tagged against it, with what the price did since and where it stood vs the fair value then and now; then the company's other reported figures, for context only; then the pages of the company's own documents where management explains the period (read them for what they say about this reason).",
      `Where does this reason stand NOW? reversal = it is turning against the story (${w.reversal}); continuation = it holds and gets stronger; noise = nothing moves it.`,
      DRIVER_SCOPE,
      DRIVER_GAME,
      "Weigh the news with their dates: recent beats old, several weak reversals in a row can make a strong one, one strong continuation after a reversal can cancel it.",
      "since = the day of the first news of the CURRENT state (null for noise). pricedIn = how much of that state the price has already moved (none, partly, fully), read from the price lines.",
      "headline = the current state of this reason in 4 to 5 words with its key number, like a chart label (e.g. \"YTD margin 30% vs 2023\", \"Sales growth slows to 4%\"); null for noise.",
      own
        ? "magnitude = the change in ONE of this reason's own figures above: series = its key in brackets, from and to with their periods, the change, and size: material or small. null when none of them moved or for noise; never a figure from the company's other figures."
        : "magnitude = null: this reason has no figure of its own.",
      "explanation = 3 to 6 sentences on this reason: what changed in the business and WHY (never only \"profit rose\": the cause behind it), in management's words where the documents give them (quoted), and why it lasts or not.",
      "citations = every sentence you quote, copied EXACTLY as printed in the documents below, with the label and page it sits on ([] when no document says it).",
      ...(last ? ["", last] : []),
    ].join("\n");
    const j = await judgeOnce(store, db, complete, {
      subjectKind: "driver-state",
      subjectId: driver.id,
      questionKey: `${DRIVER_STATE_QUESTION}:${d.version}:${fnv(`${base}|${driver.category}|${driver.title}|${driver.text}|${driver.moveIds.join(",")}|${key}|${own ?? ""}`)}`,
      question: `${DRIVER_STATE_QUESTION}: ${driver.title}`,
      prompt: `${question}\n\nNews:\n${input}\n\nThe company's other reported figures (context only: a change there belongs to the reason about it):\n${figures}\n\nCompany documents:\n${documents}\n\nJSON: {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "durability": <structural | temporary | n-a>, "magnitude": {"figure": "<e.g. Backlog>", "series": "<its key, e.g. qline:backlog>", "from": "<e.g. 1.0x revenue, FY2024>", "to": "<e.g. 2.1x revenue, FY2025>", "change": "<e.g. +110%>", "size": <material | small>} or null, "since": "<YYYY-MM-DD or null>", "pricedIn": <none | partly | fully>, "headline": "<4-5 words with the number, or null>", "explanation": "<3 to 6 sentences>", "citations": [{"doc": "<D1>", "page": <page number>, "quote": "<exact words>"}], "why": "<one short sentence for a reader who has not seen the news>"}`,
      withSignal: false,
      pages,
      magnitudeKeys: new Set(ownKeys),
      writeReason: true,
    });
    const raw = rawOf(j);
    drivers.push({
      id: driver.id,
      driverId: driver.id,
      verdict: j.verdict,
      probability: j.probability,
      reason: j.reason,
      judgmentId: j.id,
      evidenceIds: ids,
      headline: raw.headline ?? null,
      since: raw.since ?? null,
      pricedIn: raw.pricedIn ?? null,
      signal: null,
      at: j.createdAt.toISOString(),
      durability: raw.durability ?? null,
      magnitude: raw.magnitude ?? null,
      conclusion: raw.reason ?? null,
      explanation: raw.explanation ?? null,
      citations: raw.citations ?? [],
    });
  }

  const size = (v: StateVerdict) => (v.magnitude ? `, ${v.magnitude.figure}${v.magnitude.from && v.magnitude.to ? ` ${v.magnitude.from} to ${v.magnitude.to}` : ""}${v.magnitude.change ? ` (${v.magnitude.change})` : ""}, ${v.magnitude.size}` : "");
  const input = d.drivers
    .map((x, i) => {
      const v = drivers[i];
      return `${x.rank}. ${x.title} (${x.category}): ${v.verdict}${v.durability && v.durability !== "n-a" ? `, ${v.durability}` : ""}${size(v)}${v.since ? ` since ${v.since}` : ""}${v.pricedIn ? `, priced in: ${v.pricedIn}` : ""}. ${v.conclusion ?? v.reason ?? ""}`;
    })
    .join("\n");
  const path = await pathLines(db, symbol);
  const last = await lastReading(db, "thesis-state", thesisId(symbol, side), THESIS_STATE_QUESTION, true);
  const question = [
    ...story,
    "",
    "The reasons the market holds this story (Narrative Drivers, most important first) and where each one stands now (its tag, whether the change lasts, how big):",
    input,
    "",
    "The story is these reasons and nothing else: it turns only as far as they turn. A change in the business that none of them is about is not part of this story; when no reason is turning, the story is not turning, however good or bad the company's other numbers look.",
    "",
    "The price path and the fair value over time:",
    path,
    "",
    `1) tag: where does the WHOLE story stand? reversal = it is turning (${w.reversal}); continuation = it holds and gets stronger; noise = nothing moves it. Weigh the drivers by importance: the first one matters most.`,
    "A story turns for real only on a structural change in the business; a temporary one (one-off, input price, pulled-forward demand, over-earning) is weak at most, and so is a small one: strong needs structural AND material.",
    `2) signal: does this thesis give a ${w.signal} NOW? Only a turning story can, and only while the price has not yet made the move: weigh where the price sits vs the fair value base and its range ends, how much of the turn the price already moved since the news, and how recent the turn is. A turn the price has already fully priced in (the price reached the fair value) is no signal. strong = a clear, recent, structural and material turn with most of the move still ahead; weak = an early, partial, temporary or small turn, or half priced in; none = no signal.`,
    "since = the day the current tag started (null for noise). pricedIn = how much of the turn the price has already moved.",
    ...(last ? ["", last] : []),
  ].join("\n");
  const t = await judgeOnce(store, db, complete, {
    subjectKind: "thesis-state",
    subjectId: thesisId(symbol, side),
    questionKey: `${THESIS_STATE_QUESTION}:${d.version}:${fnv(`${base}|${drivers.map((x) => x.judgmentId).join(",")}`)}`,
    question: `${THESIS_STATE_QUESTION}: ${symbol} ${side}`,
    prompt: `${question}\n\nJSON: {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "signal": <strong | weak | none>, "since": "<YYYY-MM-DD or null>", "pricedIn": <none | partly | fully>, "why": "<one or two short sentences: which reason(s) turn or hold, and why it signals or not, with the price vs the fair value>"}`,
    withSignal: true,
  });
  const reversals = rows
    .flatMap((e) => e.verdicts.filter((v) => v.effect === "reversal" && d.drivers.some((x) => x.id === v.driverId)).map((v) => ({ e, v })))
    .sort((a, b) => verdictRank(a.v) - verdictRank(b.v) || b.e.eventAt.getTime() - a.e.eventAt.getTime());
  const raw = rawOf(t);
  const thesis: StateVerdict = { id: thesisId(symbol, side), driverId: null, verdict: t.verdict, probability: t.probability, reason: t.reason, judgmentId: t.id, evidenceIds: [...new Set(reversals.map((x) => x.e.id))], headline: null, since: raw.since ?? null, pricedIn: raw.pricedIn ?? null, signal: raw.signal ?? "noise", at: t.createdAt.toISOString() };
  return { side, drivers, thesis };
}

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
    // Driver Signal (Kevin 2026-11-19): asked only of the drivers the market has shown it trades on (driver-confidence
    // strong or weak); a noise driver, or one not tested yet, never signals. None left = no signal, no call.
    const confident = await confidentDriverIds(ctx.db, symbol);
    const drivers = d.drivers.filter((x) => confident.has(x.id));
    if (drivers.length === 0) return { request: { symbol, side, version: d.version, confident: 0 }, httpStatus: null, payload: noConfidentDriver(symbol, side) };
    const charts = await driverExhibits(ctx.db, drivers.map((x) => x.id));
    const payload = await judgeThesis(ctx.db, ctx.complete, dbStore(ctx.db), symbol, { side, version: d.version, narrative: d.narrative, market: d.market, drivers: drivers.map((x) => ({ ...x, moveIds: x.moveIds ?? [], exhibits: charts.get(x.id) ?? [] })) });
    return { request: { symbol, side, version: d.version, confident: drivers.length }, httpStatus: null, payload };
  },
};

/** The thesis state when no driver can be trusted yet: noise, no signal, said in words. */
export function noConfidentDriver(symbol: string, side: ThesisSide, now = new Date()): NarrativeStatePayload {
  return {
    side,
    drivers: [],
    thesis: { id: thesisId(symbol, side), driverId: null, verdict: "noise", probability: 1, reason: "No driver the market has shown it trades on: nothing can signal yet.", judgmentId: null, evidenceIds: [], headline: null, since: null, pricedIn: null, signal: "noise", at: now.toISOString() },
  };
}

/** Each driver's charts (gold.exhibits), in rank order: what its own figures are. */
export async function driverExhibits(db: Db, driverIds: string[]): Promise<Map<string, DriverExhibit[]>> {
  const out = new Map<string, DriverExhibit[]>();
  if (driverIds.length === 0) return out;
  const rows = await db.select({ driverId: exhibits.driverId, title: exhibits.title, series: exhibits.series }).from(exhibits).where(inArray(exhibits.driverId, driverIds)).orderBy(asc(exhibits.rank));
  for (const r of rows) out.set(r.driverId, [...(out.get(r.driverId) ?? []), { title: r.title, series: r.series.map((s) => s.key) }]);
  return out;
}

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
      rows.push({ id: v.id, symbol, side, level, driverId: v.driverId, effect: t.effect, strength: t.strength, why: v.reason, probability: v.probability, evidenceIds: v.evidenceIds, headline: v.headline ?? null, since: v.since, pricedIn: v.pricedIn, signal: v.signal, durability: v.durability ?? null, magnitude: v.magnitude ?? null, reason: v.conclusion ?? null, explanation: v.explanation ?? null, citations: v.citations ?? [], judgmentId: v.judgmentId, asOf: new Date(v.at) });
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
