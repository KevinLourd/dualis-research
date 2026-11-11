import { and, eq, inArray } from "drizzle-orm";
import { figuresText } from "../analysis/facts";
import { evidence, exhibits, fairValues, NARRATIVE_TAGS, narrativeDrivers, narratives, parseTag, PRICED_IN, type EvidenceVerdict, type GoldMarketReaction, type PricedIn, type Strength, type ThesisSide } from "@/db/schema/analysis";
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
import { priceAndFairValue, SIDE, thesisId } from "../analysis/sides";
import { reactionLine } from "../market-reaction/compute";
import { reactionsOf } from "../market-reaction";

export { EVIDENCE_WINDOW_DAYS, itemsOf, type EvidenceItem } from "./items";


export const EVIDENCE_DIMENSION = "evidence";
export const EVIDENCE_SUBJECT_KIND = "evidence";
/**
 * Bump when the question changes meaning. The key also carries the drivers' version: new drivers = judged again.
 * v3 (Kevin 2026-11-06): every item judged against EACH driver, five tags (reversal / continuation strong or weak, noise).
 * v4 (Kevin 2026-11-09): per thesis side, with the fair value (base, low, high) and what the price did around the item;
 * the judge also says how much of the item's effect the price already moved (priced in).
 * v5 (Kevin 2026-11-11, Water Oasis): the judge reads the company's reported figures (years, quarters, half years,
 * revenue by stream): a results filing came as a title only and was judged « no revenue data ».
 */
export const EVIDENCE_QUESTION = "evidence@v5";
const PARALLEL = 6;

export const evidenceKey = (driversVersion: string) => `${EVIDENCE_QUESTION}:${driversVersion}`;

type Drivers = {
  side: ThesisSide;
  version: string;
  drivers: (typeof narrativeDrivers.$inferSelect)[];
  narrative: string;
  gapPct: number | null;
  /** Today's quote and fair value (base, low, high) in the same unit, or null. */
  market: Awaited<ReturnType<typeof priceAndFairValue>>;
};

/** One thesis' narrative and drivers (rank order), with today's price and fair value. */
export async function driversOf(db: Db, symbol: string, side: ThesisSide): Promise<Drivers | null> {
  const drivers = (await db.select().from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, symbol), eq(narrativeDrivers.side, side)))).sort((a, b) => a.rank - b.rank);
  const [n] = await db.select().from(narratives).where(eq(narratives.id, thesisId(symbol, side)));
  if (drivers.length === 0 || !n) return null;
  return { side, version: n.version, drivers, narrative: n.text, gapPct: await gapOf(db, symbol), market: await priceAndFairValue(db, symbol) };
}

const px = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(2));
/** Where the price sits today vs the fair value and its range, for every judge. */
export function marketLine(m: Drivers["market"]): string {
  if (!m) return "Today: no comparable quote and fair value.";
  const range = m.fv.low !== null && m.fv.high !== null ? ` (range ${px(m.fv.low)} to ${px(m.fv.high)})` : "";
  return `Today (${m.stamp}): price ${px(m.price)} ${m.currency ?? ""}, fair value ${px(m.fv.value)}${range}, the price ${((m.price / m.fv.value - 1) * 100).toFixed(1)}% vs the fair value.`;
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

/** Runner / judgment subject: `<symbol>|<kind>:<item id>#<side>:<driver rank>`. */
export const evidenceSubject = (symbol: string, kind: string, id: string, side: ThesisSide, rank: number) => `${symbol}|${kind}:${id}#${side}:${rank}`;
/** gold.evidence id (one per item): `<symbol>|<kind>:<item id>`. */
export const evidenceId = (symbol: string, kind: string, id: string) => `${symbol}|${kind}:${id}`;
export function parseEvidenceSubject(subject: string): { symbol: string; kind: "news" | "filing"; id: string; side: ThesisSide; rank: number } {
  const i = subject.indexOf("|");
  const h = subject.lastIndexOf("#");
  const rest = subject.slice(i + 1, h);
  const j = rest.indexOf(":");
  const [side, rank] = subject.slice(h + 1).split(":");
  return { symbol: subject.slice(0, i), kind: rest.slice(0, j) as "news" | "filing", id: rest.slice(j + 1), side: side as ThesisSide, rank: Number(rank) };
}

/** Items per LLM call (Kevin 2026-11-06 « speeder x10 »: 584 one-pair calls took 14 min; batches of 15 items x every driver take ~1). */
export const BATCH_ITEMS = 15;

/** Batch subject: `<symbol>|batch|<side>|<kind>:<item id>,...`: the items of one call, each judged against every driver of one thesis. */
export const batchSubject = (symbol: string, side: ThesisSide, items: { kind: string; id: string }[]) => `${symbol}|batch|${side}|${items.map((i) => `${i.kind}:${i.id}`).join(",")}`;
export function parseBatchSubject(subject: string): { symbol: string; side: ThesisSide; items: { kind: "news" | "filing"; id: string }[] } {
  const [symbol, , side, list] = subject.split("|");
  return { symbol, side: side as ThesisSide, items: list.split(",").map((x) => ({ kind: x.slice(0, x.indexOf(":")) as "news" | "filing", id: x.slice(x.indexOf(":") + 1) })) };
}

/** Items of each current thesis with a driver not yet judged under its current drivers, in batches. */
async function pendingSubjects(db: Db): Promise<string[]> {
  const symbols = new Set(await analysedSymbols(db));
  const theses = (await db.select({ id: narratives.id, symbol: narratives.symbol, side: narratives.side, version: narratives.version }).from(narratives)).filter((n) => symbols.has(n.symbol));
  const done = new Set(
    (await db.select({ subjectId: silver.judgments.subjectId, questionKey: silver.judgments.questionKey }).from(silver.judgments).where(eq(silver.judgments.subjectKind, EVIDENCE_SUBJECT_KIND))).map((j) => `${j.subjectId}\u0000${j.questionKey}`),
  );
  const out: string[] = [];
  const sinces = await narrativeSinceOf(db, [...new Set(theses.map((t) => t.symbol))]);
  const items = new Map<string, EvidenceItem[]>();
  for (const t of theses) {
    // Too old items are never asked: before the month the thesis' story took hold (or the cap, until it is judged).
    const since = sinces.get(t.id)?.since ?? sinceCap();
    const ranks = (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, t.symbol), eq(narrativeDrivers.side, t.side)))).map((r) => r.rank);
    if (!items.has(t.symbol)) items.set(t.symbol, await itemsOf(db, t.symbol));
    const pending = items.get(t.symbol)!.filter((item) => item.at >= since && ranks.some((rank) => !done.has(`${evidenceSubject(t.symbol, item.kind, item.id, t.side, rank)}\u0000${evidenceKey(t.version)}`)));
    for (let i = 0; i < pending.length; i += BATCH_ITEMS) out.push(batchSubject(t.symbol, t.side, pending.slice(i, i + BATCH_ITEMS)));
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

/** One call: every item of the batch against every driver of ONE thesis, each item with what the price did around it. */
export function batchPrompt(symbol: string, d: Drivers, items: EvidenceItem[], reactions: Map<string, GoldMarketReaction> = new Map(), figures: string | null = null): string {
  const side = SIDE[d.side];
  return [
    `${symbol}, ${side.label.toLowerCase()}: ${side.story}.`,
    `The narrative: ${d.narrative}`,
    marketLine(d.market),
    "The reasons the market holds it (Narrative Drivers):",
    ...d.drivers.map((x) => `${x.rank}. [${x.category}] ${x.title}. ${x.text}`),
    "",
    ...(figures ? [figures, ""] : []),
    "For EACH item below and EACH driver, judged on its own: what does the item do to THAT reason?",
    `reversal = it contradicts the reason: ${side.reversal}. continuation = it confirms the reason: ${side.continuation}. noise = it does not bear on this reason (routine filings, meeting notices, small holdings reports, unrelated news).`,
    "strong = a concrete, company-specific fact (results, guidance, a contract, a deal, insider or capital action); weak = indirect or loose (industry read-through, opinion, a recap).",
    "Then, per item: how much of its effect has the price ALREADY moved, from the price line under it (the move vs the S&P 500 since, and where the price sits vs the fair value then and now)? none = the price has not reacted; partly = it moved but still has room toward or away from the fair value; fully = the move already took the price where this news says it should be.",
    "",
    "Items:",
    ...items.map((it, i) =>
      [`[${i + 1}] ${it.at.toISOString().slice(0, 10)}, ${it.kind}${it.publisher ? ` (${it.publisher})` : ""}: ${it.title}`, it.summary ? `    Summary: ${it.summary.slice(0, 700)}` : null, `    ${reactionLine(reactions.get(evidenceId(symbol, it.kind, it.id)))}`].filter(Boolean).join("\n"),
    ),
    "",
    `JSON: {"items": [{"n": <item number>, "pricedIn": <one of ${PRICED_IN.join(" | ")}>, "drivers": {${d.drivers.map((x) => `"${x.rank}": {"tag": <one of ${NARRATIVE_TAGS.join(" | ")}>, "p": <0..1 confidence>, "why": "<one short sentence>", "cited": "<the sentence of the item it rests on, verbatim, or null>"}`).join(", ")}}}]}`,
    `Every item 1 to ${items.length}, every driver.`,
  ].join("\n");
}

type BatchVerdict = { tag: string; p: number; why: string | null; cited: string | null; pricedIn: PricedIn | null };
export function parseBatch(text: string, items: number, ranks: number[]): Map<string, BatchVerdict> {
  const o = JSON.parse(firstJsonObject(text)) as { items?: { n?: unknown; pricedIn?: unknown; drivers?: Record<string, { tag?: unknown; p?: unknown; why?: unknown; cited?: unknown }> }[] };
  const out = new Map<string, BatchVerdict>();
  for (const it of o.items ?? []) {
    const n = Number(it.n);
    const pricedIn = PRICED_IN.includes(it.pricedIn as PricedIn) ? (it.pricedIn as PricedIn) : null;
    for (const rank of ranks) {
      const v = it.drivers?.[String(rank)];
      if (!v || typeof v.tag !== "string" || !NARRATIVE_TAGS.includes(v.tag as never)) continue;
      const p = typeof v.p === "number" && v.p >= 0 && v.p <= 1 ? v.p : 0.5;
      out.set(`${n}#${rank}`, { tag: v.tag, p, why: typeof v.why === "string" && v.why.trim() ? stripDashes(v.why.trim()) : null, cited: typeof v.cited === "string" && v.cited.trim() ? v.cited : null, pricedIn });
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
    const { symbol, side, items: wanted } = parseBatchSubject(subject);
    const d = await driversOf(ctx.db, symbol, side);
    const all = await itemsThisRun(ctx, symbol);
    const items = wanted.map((w) => all.find((x) => x.kind === w.kind && x.id === w.id)).filter((x): x is EvidenceItem => !!x);
    if (!d || items.length === 0) return { request: { symbol, side, items: wanted.length }, httpStatus: null, error: "no drivers or no item for this batch any more" };
    const ranks = d.drivers.map((x) => x.rank);
    const r = await ctx.complete({ system: EVIDENCE_SYSTEM, prompt: batchPrompt(symbol, d, items, await reactionsOf(ctx.db, symbol), await figuresText(ctx.db, symbol)) });
    const verdicts = parseBatch(r.text, items.length, ranks);
    const questionKey = evidenceKey(d.version);
    const rows = items.flatMap((it, i) =>
      ranks.map((rank) => {
        const v = verdicts.get(`${i + 1}#${rank}`)!;
        return { subjectKind: EVIDENCE_SUBJECT_KIND, subjectId: evidenceSubject(symbol, it.kind, it.id, side, rank), questionKey, question: `${EVIDENCE_QUESTION} batch: item vs ${side} driver ${rank}`, verdict: v.tag, probability: v.p, citedSentence: v.cited, reason: v.why, model: r.model, raw: { batch: subject.length, pricedIn: v.pricedIn } };
      }),
    );
    await ctx.db.insert(silver.judgments).values(rows).onConflictDoNothing();
    return { request: { symbol, side, items: items.length, drivers: ranks.length, questionKey }, httpStatus: null, payload: { judged: rows.length, model: r.model } };
  },
};

export const evidenceDim: Dimension = {
  name: EVIDENCE_DIMENSION,
  description: "Every news item and filing of the last 12 months, judged against EACH Narrative Driver of each thesis with the fair value and what the price did around it: reversal / continuation (strong or weak) or noise, why, how much the price already moved, and the Exhibit that shows it. Once per thesis version.",
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

/** gold.evidence: every item of an analysed ticker judged against every driver of its current theses (noise included); its top line = the strongest verdict. */
export async function rebuildEvidence(db: Db): Promise<number> {
  const symbols = new Set(await analysedSymbols(db));
  const theses = (await db.select({ id: narratives.id, symbol: narratives.symbol, side: narratives.side, version: narratives.version }).from(narratives)).filter((n) => symbols.has(n.symbol));
  // Egress: only the current thesis versions' judgments and only the columns read here (never `question`).
  const keys = [...new Set(theses.map((t) => evidenceKey(t.version)))];
  const j = silver.judgments;
  const js = keys.length
    ? await db
        .select({ id: j.id, subjectId: j.subjectId, questionKey: j.questionKey, verdict: j.verdict, probability: j.probability, reason: j.reason, citedSentence: j.citedSentence, raw: j.raw })
        .from(j)
        .where(and(eq(j.subjectKind, EVIDENCE_SUBJECT_KIND), inArray(j.questionKey, keys)))
    : [];
  const byKey = new Map(js.map((j) => [`${j.subjectId}\u0000${j.questionKey}`, j]));
  const tickers = [...new Set(theses.map((t) => t.symbol))];
  const firstExhibit = new Map<string, string>();
  if (tickers.length) for (const e of (await db.select().from(exhibits).where(inArray(exhibits.symbol, tickers))).sort((a, b) => a.rank - b.rank)) if (!firstExhibit.has(e.driverId)) firstExhibit.set(e.driverId, e.id);
  const rows: (typeof evidence.$inferInsert)[] = [];
  const sinces = await narrativeSinceOf(db, tickers);
  for (const symbol of tickers) {
    const mine = theses.filter((t) => t.symbol === symbol);
    const ranksBySide = new Map<ThesisSide, number[]>();
    for (const t of mine) ranksBySide.set(t.side, (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, symbol), eq(narrativeDrivers.side, t.side)))).map((r) => r.rank).sort((a, b) => a - b));
    for (const item of await itemsOf(db, symbol)) {
      // A thesis judges the item only from the month its story took hold (Too old before: already in the price).
      const open = mine.filter((t) => item.at >= (sinces.get(t.id)?.since ?? sinceCap()));
      if (open.length === 0) {
        // Too old for every thesis (Kevin 2026-11-06): judged against no driver. Shown once its month is judged.
        const judged = mine.map((t) => sinces.get(t.id)).filter((x): x is { since: Date; judgmentId: string } => !!x).sort((a, b) => a.since.getTime() - b.since.getTime());
        if (judged.length) rows.push(tooOldRow(symbol, item, judged[0].since, judged[0].judgmentId));
        continue;
      }
      const verdicts: EvidenceVerdict[] = [];
      let expected = 0;
      for (const t of open) {
        const ranks = ranksBySide.get(t.side) ?? [];
        expected += ranks.length;
        for (const rank of ranks) {
          const jv = byKey.get(`${evidenceSubject(symbol, item.kind, item.id, t.side, rank)}\u0000${evidenceKey(t.version)}`);
          if (!jv) continue;
          const tag = parseTag(jv.verdict);
          const pricedIn = (jv.raw as { pricedIn?: PricedIn | null } | null)?.pricedIn ?? null;
          verdicts.push({ driverId: `${symbol}:${t.side}:${rank}`, side: t.side, rank, effect: tag.effect, strength: tag.strength, probability: jv.probability, why: jv.reason, citedSentence: jv.citedSentence, judgmentId: jv.id, pricedIn });
        }
      }
      // Shown once every driver has its verdict: a half-judged item would rank on a partial view.
      if (verdicts.length === 0 || verdicts.length < expected) continue;
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
    for (let i = 0; i < rows.length; i += 500) await tx.insert(evidence).values(rows.slice(i, i + 500));
  });
  return rows.length;
}
