import { and, eq, inArray } from "drizzle-orm";
import { evidence, exhibits, fairValues, NARRATIVE_TAGS, narrativeDrivers, narratives, parseTag, type EvidenceVerdict, type Strength } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { majorUnit } from "../financials/derive";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";
import { firstJsonObject } from "@/llm/judge";
import { itemsOf, type EvidenceItem } from "./items";
import { narrativeSinceOf, sinceCap } from "../narrative-since/since";

export { EVIDENCE_WINDOW_DAYS, itemsOf, type EvidenceItem } from "./items";


export const EVIDENCE_DIMENSION = "evidence";
export const EVIDENCE_SUBJECT_KIND = "evidence";
/**
 * Bump when the question changes meaning. The key also carries the drivers' version: new drivers = judged again.
 * v3 (Kevin 2026-11-06): every item judged against EACH driver, five tags (reversal / continuation strong or weak, noise).
 */
export const EVIDENCE_QUESTION = "evidence@v3";
const PARALLEL = 6;

export const evidenceKey = (driversVersion: string) => `${EVIDENCE_QUESTION}:${driversVersion}`;

type Drivers = { version: string; drivers: (typeof narrativeDrivers.$inferSelect)[]; narrative: string; gapPct: number | null };

/** Which side the narrative sits on: below fair value (pessimistic story, a long) or above (optimistic, a short). */
export function sideWords(gapPct: number | null): { story: string; reversal: string } {
  if (gapPct === null) return { story: "the market's story", reversal: "the reason turns against the story" };
  return gapPct < 0
    ? { story: "a pessimistic story that keeps the price BELOW fair value", reversal: "the bad reason turns: things get better than the market believes (an inflection)" }
    : { story: "an optimistic story that keeps the price ABOVE fair value", reversal: "the good reason breaks: things get worse than the market believes (a crack)" };
}

export async function driversOf(db: Db, symbol: string): Promise<Drivers | null> {
  const drivers = (await db.select().from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol))).sort((a, b) => a.rank - b.rank);
  const [n] = await db.select().from(narratives).where(eq(narratives.symbol, symbol));
  if (drivers.length === 0 || !n) return null;
  return { version: n.version, drivers, narrative: n.text, gapPct: await gapOf(db, symbol) };
}

/** quote / fair value - 1 from gold (same currency only), or null. */
export async function gapOf(db: Db, symbol: string): Promise<number | null> {
  const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, symbol));
  const [q] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol));
  if (!fv || !q || !(fv.value > 0)) return null;
  const m = majorUnit(q.close, q.currency);
  if (fv.currency && m.currency && fv.currency !== m.currency) return null;
  return m.price / fv.value - 1;
}

/** Runner / judgment subject: `<symbol>|<kind>:<item id>#<driver rank>`. */
export const evidenceSubject = (symbol: string, kind: string, id: string, rank: number) => `${symbol}|${kind}:${id}#${rank}`;
/** gold.evidence id (one per item): `<symbol>|<kind>:<item id>`. */
export const evidenceId = (symbol: string, kind: string, id: string) => `${symbol}|${kind}:${id}`;
export function parseEvidenceSubject(subject: string): { symbol: string; kind: "news" | "filing"; id: string; rank: number } {
  const i = subject.indexOf("|");
  const h = subject.lastIndexOf("#");
  const rest = subject.slice(i + 1, h);
  const j = rest.indexOf(":");
  return { symbol: subject.slice(0, i), kind: rest.slice(0, j) as "news" | "filing", id: rest.slice(j + 1), rank: Number(subject.slice(h + 1)) };
}

/** Items per LLM call (Kevin 2026-11-06 « speeder x10 »: 584 one-pair calls took 14 min; batches of 15 items x every driver take ~1). */
export const BATCH_ITEMS = 15;

/** Batch subject: `<symbol>|batch|<kind>:<item id>,<kind>:<item id>...`: the items of one call, each judged against every driver. */
export const batchSubject = (symbol: string, items: { kind: string; id: string }[]) => `${symbol}|batch|${items.map((i) => `${i.kind}:${i.id}`).join(",")}`;
export function parseBatchSubject(subject: string): { symbol: string; items: { kind: "news" | "filing"; id: string }[] } {
  const [symbol, , list] = subject.split("|");
  return { symbol, items: list.split(",").map((x) => ({ kind: x.slice(0, x.indexOf(":")) as "news" | "filing", id: x.slice(x.indexOf(":") + 1) })) };
}

/** Items of the analysed tickers with a driver not yet judged under the current drivers, in batches. */
async function pendingSubjects(db: Db): Promise<string[]> {
  const versions = new Map((await db.select({ symbol: narratives.symbol, version: narratives.version }).from(narratives)).map((n) => [n.symbol, n.version]));
  const done = new Set(
    (await db.select({ subjectId: silver.judgments.subjectId, questionKey: silver.judgments.questionKey }).from(silver.judgments).where(eq(silver.judgments.subjectKind, EVIDENCE_SUBJECT_KIND))).map((j) => `${j.subjectId}\u0000${j.questionKey}`),
  );
  const out: string[] = [];
  const symbols = await analysedSymbols(db);
  const sinces = await narrativeSinceOf(db, symbols);
  for (const symbol of symbols) {
    const v = versions.get(symbol);
    if (!v) continue;
    // Too old items are never asked: before the month the current story took hold (or the cap, until it is judged).
    const since = sinces.get(symbol)?.since ?? sinceCap();
    const ranks = (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol))).map((r) => r.rank);
    const pending = (await itemsOf(db, symbol)).filter((item) => item.at >= since && ranks.some((rank) => !done.has(`${evidenceSubject(symbol, item.kind, item.id, rank)}\u0000${evidenceKey(v)}`)));
    for (let i = 0; i < pending.length; i += BATCH_ITEMS) out.push(batchSubject(symbol, pending.slice(i, i + BATCH_ITEMS)));
  }
  return out;
}

/** One read of a ticker's items per run (keyed on the run's fetch function), not one per batch. */
const runItems = new WeakMap<typeof fetch, Map<string, Promise<EvidenceItem[]>>>();
function itemsThisRun(ctx: SourceContext, symbol: string): Promise<EvidenceItem[]> {
  let cache = runItems.get(ctx.fetch);
  if (!cache) runItems.set(ctx.fetch, (cache = new Map()));
  let items = cache.get(symbol);
  if (!items) cache.set(symbol, (items = itemsOf(ctx.db!, symbol)));
  return items;
}

const EVIDENCE_SYSTEM = [
  "You tag news items and filings for a small-cap long/short analyst: for each item, what it does to EACH reason the market holds its story on the stock.",
  "Answer with JSON only, no prose, no code fence. Plain English, no em dash.",
].join(" ");

/** One call: every item of the batch against every driver; the same contract as one judgment per (item, driver). */
export function batchPrompt(symbol: string, d: Drivers, items: EvidenceItem[]): string {
  const side = sideWords(d.gapPct);
  return [
    `${symbol}. The market's narrative, ${side.story}: ${d.narrative}`,
    "The reasons the market holds it (Narrative Drivers):",
    ...d.drivers.map((x) => `${x.rank}. [${x.category}] ${x.title}. ${x.text}`),
    "",
    "For EACH item below and EACH driver, judged on its own: what does the item do to THAT reason?",
    `reversal = it contradicts the reason: ${side.reversal}. continuation = it confirms the reason, the story gets stronger. noise = it does not bear on this reason (routine filings, meeting notices, small holdings reports, unrelated news).`,
    "strong = a concrete, company-specific fact (results, guidance, a contract, a deal, insider or capital action); weak = indirect or loose (industry read-through, opinion, a recap).",
    "",
    "Items:",
    ...items.map((it, i) => [`[${i + 1}] ${it.at.toISOString().slice(0, 10)}, ${it.kind}${it.publisher ? ` (${it.publisher})` : ""}: ${it.title}`, it.summary ? `    Summary: ${it.summary.slice(0, 700)}` : null].filter(Boolean).join("\n")),
    "",
    `JSON: {"items": [{"n": <item number>, "drivers": {${d.drivers.map((x) => `"${x.rank}": {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "why": "<one short sentence>", "cited": "<the sentence of the item it rests on, verbatim, or null>"}`).join(", ")}}}]}`,
    `Every item 1 to ${items.length}, every driver.`,
  ].join("\n");
}

type BatchVerdict = { tag: string; p: number; why: string | null; cited: string | null };
export function parseBatch(text: string, items: number, ranks: number[]): Map<string, BatchVerdict> {
  const o = JSON.parse(firstJsonObject(text)) as { items?: { n?: unknown; drivers?: Record<string, { tag?: unknown; p?: unknown; why?: unknown; cited?: unknown }> }[] };
  const out = new Map<string, BatchVerdict>();
  for (const it of o.items ?? []) {
    const n = Number(it.n);
    for (const rank of ranks) {
      const v = it.drivers?.[String(rank)];
      if (!v || typeof v.tag !== "string" || !NARRATIVE_TAGS.includes(v.tag as never)) continue;
      const p = Number(v.p);
      out.set(`${n}#${rank}`, { tag: v.tag, p: p >= 0 && p <= 1 ? p : 0.5, why: typeof v.why === "string" && v.why.trim() ? stripDashes(v.why.trim()) : null, cited: typeof v.cited === "string" && v.cited.trim() ? v.cited : null });
    }
  }
  const missing: string[] = [];
  for (let n = 1; n <= items; n++) for (const rank of ranks) if (!out.has(`${n}#${rank}`)) missing.push(`${n}#${rank}`);
  if (missing.length) throw new Error(`evidence batch: no valid verdict for ${missing.length} item x driver pairs (${missing.slice(0, 5).join(", ")})`);
  return out;
}

export const evidenceSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: PARALLEL,
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("evidence: needs the database");
    if (!ctx.complete) throw new Error("evidence: no LLM in the collector context (cli.ts sets ctx.complete)");
    const { symbol, items: wanted } = parseBatchSubject(subject);
    const d = await driversOf(ctx.db, symbol);
    const all = await itemsThisRun(ctx, symbol);
    const items = wanted.map((w) => all.find((x) => x.kind === w.kind && x.id === w.id)).filter((x): x is EvidenceItem => !!x);
    if (!d || items.length === 0) return { request: { symbol, items: wanted.length }, httpStatus: null, error: "no drivers or no item for this batch any more" };
    const ranks = d.drivers.map((x) => x.rank);
    const r = await ctx.complete({ system: EVIDENCE_SYSTEM, prompt: batchPrompt(symbol, d, items) });
    const verdicts = parseBatch(r.text, items.length, ranks);
    const questionKey = evidenceKey(d.version);
    const rows = items.flatMap((it, i) =>
      ranks.map((rank) => {
        const v = verdicts.get(`${i + 1}#${rank}`)!;
        return { subjectKind: EVIDENCE_SUBJECT_KIND, subjectId: evidenceSubject(symbol, it.kind, it.id, rank), questionKey, question: `${EVIDENCE_QUESTION} batch: item vs driver ${rank}`, verdict: v.tag, probability: v.p, citedSentence: v.cited, reason: v.why, model: r.model, raw: { batch: subject.length } };
      }),
    );
    await ctx.db.insert(silver.judgments).values(rows).onConflictDoNothing();
    return { request: { symbol, items: items.length, drivers: ranks.length, questionKey }, httpStatus: null, payload: { judged: rows.length, model: r.model } };
  },
};

export const evidenceDim: Dimension = {
  name: EVIDENCE_DIMENSION,
  description: "Every news item and filing of the last 12 months, judged against EACH Narrative Driver: reversal / continuation (strong or weak) or noise, why, and the Exhibit that shows it. Once per driver version.",
  sources: [evidenceSource],
  subjects: pendingSubjects,
  promote: async (db): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await rebuildEvidence(db) } }),
};

/** Rank of a tag: strongest first (a strong reversal ranks above a strong continuation, both above weak, noise last). */
export function verdictRank(v: Pick<EvidenceVerdict, "effect" | "strength">): number {
  const S: Record<Strength, number> = { strong: 0, weak: 2, noise: 4 };
  return S[v.strength] + (v.effect === "reversal" ? 0 : 1);
}

/** gold.evidence row of an item from before the current story: tag "Too old", no driver verdict. */
export function tooOldRow(symbol: string, item: EvidenceItem, since: Date, judgmentId: string): typeof evidence.$inferInsert {
  const month = since.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    id: evidenceId(symbol, item.kind, item.id),
    symbol,
    driverId: null,
    effect: "too-old",
    strength: "noise",
    probability: 1,
    why: `Before ${month}, when the market adopted its current story: already in the price.`,
    citedSentence: null,
    exhibitId: null,
    kind: item.kind,
    headline: item.title,
    url: item.url,
    publisher: item.publisher,
    eventDay: item.at.toISOString().slice(0, 10),
    eventAt: item.at,
    newsItemIds: item.kind === "news" ? [item.id] : [],
    filingIds: item.kind === "filing" ? [item.id] : [],
    sources: item.sources,
    judgmentId,
    verdicts: [],
  };
}

/** gold.evidence: every item of an analysed ticker judged against every current driver (noise included); its top line = the strongest verdict. */
export async function rebuildEvidence(db: Db): Promise<number> {
  const versions = new Map((await db.select({ symbol: narratives.symbol, version: narratives.version }).from(narratives)).map((n) => [n.symbol, n.version]));
  const symbols = (await analysedSymbols(db)).filter((s) => versions.has(s));
  // Egress: only the current narrative versions' judgments and only the columns read here (never `raw` or `question`).
  const keys = [...new Set(symbols.map((s) => evidenceKey(versions.get(s)!)))];
  const j = silver.judgments;
  const js = keys.length
    ? await db
        .select({ id: j.id, subjectId: j.subjectId, questionKey: j.questionKey, verdict: j.verdict, probability: j.probability, reason: j.reason, citedSentence: j.citedSentence })
        .from(j)
        .where(and(eq(j.subjectKind, EVIDENCE_SUBJECT_KIND), inArray(j.questionKey, keys)))
    : [];
  const byKey = new Map(js.map((j) => [`${j.subjectId}\u0000${j.questionKey}`, j]));
  const firstExhibit = new Map<string, string>();
  if (symbols.length) for (const e of (await db.select().from(exhibits).where(inArray(exhibits.symbol, symbols))).sort((a, b) => a.rank - b.rank)) if (!firstExhibit.has(e.driverId)) firstExhibit.set(e.driverId, e.id);
  const rows: (typeof evidence.$inferInsert)[] = [];
  const sinces = await narrativeSinceOf(db, symbols);
  for (const symbol of symbols) {
    const ranks = (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol))).map((r) => r.rank).sort((a, b) => a - b);
    const since = sinces.get(symbol);
    for (const item of await itemsOf(db, symbol)) {
      if (item.at < (since?.since ?? sinceCap())) {
        // Too old (Kevin 2026-11-06): already in the price, judged against no driver. Shown once its month is judged.
        if (since) rows.push(tooOldRow(symbol, item, since.since, since.judgmentId));
        continue;
      }
      const verdicts: EvidenceVerdict[] = [];
      for (const rank of ranks) {
        const j = byKey.get(`${evidenceSubject(symbol, item.kind, item.id, rank)}\u0000${evidenceKey(versions.get(symbol)!)}`);
        if (!j) continue;
        const t = parseTag(j.verdict);
        verdicts.push({ driverId: `${symbol}:${rank}`, rank, effect: t.effect, strength: t.strength, probability: j.probability, why: j.reason, citedSentence: j.citedSentence, judgmentId: j.id });
      }
      // Shown once every driver has its verdict: a half-judged item would rank on a partial view.
      if (verdicts.length === 0 || verdicts.length < ranks.length) continue;
      const top = [...verdicts].sort((a, b) => verdictRank(a) - verdictRank(b) || a.rank - b.rank)[0];
      const driverId = top.effect === "noise" ? null : top.driverId;
      rows.push({
        id: evidenceId(symbol, item.kind, item.id),
        symbol,
        driverId,
        effect: top.effect,
        strength: top.strength,
        probability: top.probability,
        why: top.why,
        citedSentence: top.citedSentence,
        exhibitId: driverId ? (firstExhibit.get(driverId) ?? null) : null,
        kind: item.kind,
        headline: item.title,
        url: item.url,
        publisher: item.publisher,
        eventDay: item.at.toISOString().slice(0, 10),
        eventAt: item.at,
        newsItemIds: item.kind === "news" ? [item.id] : [],
        filingIds: item.kind === "filing" ? [item.id] : [],
        sources: [...item.sources, "claude"],
        judgmentId: top.judgmentId,
        verdicts,
      });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(evidence);
    if (rows.length) await tx.insert(evidence).values(rows);
  });
  return rows.length;
}
