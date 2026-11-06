import { and, eq, inArray, like } from "drizzle-orm";
import { evidence, exhibits, fairValues, NARRATIVE_TAGS, narrativeDrivers, narratives, parseTag, type EvidenceVerdict, type Strength } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { majorUnit } from "../financials/derive";
import { analysedSymbols } from "../watchlist";
import { itemsOf, type EvidenceItem } from "./items";

export { EVIDENCE_WINDOW_DAYS, itemsOf, type EvidenceItem } from "./items";

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

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

export function evidenceRequest(symbol: string, d: Drivers, rank: number, item: EvidenceItem): { question: string; input: string; choices: string[] } {
  const driver = d.drivers.find((x) => x.rank === rank);
  if (!driver) throw new Error(`evidence: ${symbol} has no driver ${rank}`);
  const side = sideWords(d.gapPct);
  const question = [
    `${symbol}. The market's narrative, ${side.story}: ${d.narrative}`,
    `ONE of the reasons the market holds it (Narrative Driver, ${driver.category}): ${driver.title}. ${driver.text}`,
    "",
    "What does this news item or filing do to THIS reason, and only this one?",
    `reversal = it contradicts the reason: ${side.reversal}. continuation = it confirms the reason, the story gets stronger. noise = it does not bear on this reason (routine filings, meeting notices, small holdings reports, unrelated news).`,
    "strong = a concrete, company-specific fact (results, guidance, a contract, a deal, insider or capital action); weak = indirect or loose (industry read-through, opinion, a recap).",
    "Verdict: reversal:strong, reversal:weak, noise, continuation:weak or continuation:strong.",
  ].join("\n");
  const input = [`${item.at.toISOString().slice(0, 10)}, ${item.kind}${item.publisher ? ` (${item.publisher})` : ""}: ${item.title}`, item.summary ? `Summary: ${item.summary.slice(0, 1500)}` : null].filter(Boolean).join("\n");
  return { question, input, choices: [...NARRATIVE_TAGS] };
}

/** Items of the analysed tickers not yet judged against their current drivers. */
async function pendingSubjects(db: Db): Promise<string[]> {
  const versions = new Map((await db.select({ symbol: narratives.symbol, version: narratives.version }).from(narratives)).map((n) => [n.symbol, n.version]));
  const done = new Set(
    (await db.select({ subjectId: silver.judgments.subjectId, questionKey: silver.judgments.questionKey }).from(silver.judgments).where(eq(silver.judgments.subjectKind, EVIDENCE_SUBJECT_KIND))).map((j) => `${j.subjectId}\u0000${j.questionKey}`),
  );
  const out: string[] = [];
  for (const symbol of await analysedSymbols(db)) {
    const v = versions.get(symbol);
    if (!v) continue;
    const ranks = (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol))).map((r) => r.rank);
    for (const item of await itemsOf(db, symbol))
      for (const rank of ranks) {
        const subject = evidenceSubject(symbol, item.kind, item.id, rank);
        if (!done.has(`${subject}\u0000${evidenceKey(v)}`)) out.push(subject);
      }
  }
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
    // Node only, hidden from the bundler: the console Worker lists dimensions.
    const { judge } = (await nodeImport(new URL("../../../llm/judge.ts", import.meta.url).href)) as typeof import("@/llm/judge");
    const { symbol, kind, id, rank } = parseEvidenceSubject(subject);
    const d = await driversOf(ctx.db, symbol);
    const item = (await itemsOf(ctx.db, symbol)).find((x) => x.kind === kind && x.id === id);
    if (!d || !item || !d.drivers.some((x) => x.rank === rank)) return { request: { subject }, httpStatus: null, error: "no drivers or no item for this subject any more" };
    const req = evidenceRequest(symbol, d, rank, item);
    const key = { subjectKind: EVIDENCE_SUBJECT_KIND, subjectId: subject, questionKey: evidenceKey(d.version) };
    const j = await judge(ctx.db, { ...key, ...req }, ctx.complete);
    return { request: { ...key, choices: req.choices }, httpStatus: null, payload: { judgmentId: j.id, verdict: j.verdict, probability: j.probability, citedSentence: j.citedSentence, reason: j.reason } };
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

/** gold.evidence: every item of an analysed ticker judged against every current driver (noise included); its top line = the strongest verdict. */
export async function rebuildEvidence(db: Db): Promise<number> {
  const versions = new Map((await db.select({ symbol: narratives.symbol, version: narratives.version }).from(narratives)).map((n) => [n.symbol, n.version]));
  const symbols = (await analysedSymbols(db)).filter((s) => versions.has(s));
  const js = symbols.length ? await db.select().from(silver.judgments).where(and(eq(silver.judgments.subjectKind, EVIDENCE_SUBJECT_KIND), like(silver.judgments.questionKey, `${EVIDENCE_QUESTION}:%`))) : [];
  const byKey = new Map(js.map((j) => [`${j.subjectId}\u0000${j.questionKey}`, j]));
  const firstExhibit = new Map<string, string>();
  if (symbols.length) for (const e of (await db.select().from(exhibits).where(inArray(exhibits.symbol, symbols))).sort((a, b) => a.rank - b.rank)) if (!firstExhibit.has(e.driverId)) firstExhibit.set(e.driverId, e.id);
  const rows: (typeof evidence.$inferInsert)[] = [];
  for (const symbol of symbols) {
    const ranks = (await db.select({ rank: narrativeDrivers.rank }).from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol))).map((r) => r.rank).sort((a, b) => a - b);
    for (const item of await itemsOf(db, symbol)) {
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
