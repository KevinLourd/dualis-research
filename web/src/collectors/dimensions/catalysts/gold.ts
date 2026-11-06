import { and, eq, inArray } from "drizzle-orm";
import { catalystEvents, type CatalystDirection, type CatalystKind, goldCatalysts, type SilverCatalystEvent } from "@/db/schema/catalysts";
import { filings } from "@/db/schema/gold";
import { goldNewsItems } from "@/db/schema/news";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { PromoteResult } from "../../types";
import { CATALYST_QUESTION_KEY, parseItemSubject, SUBJECT_KIND } from "./question";

/**
 * The bar for evidence worth showing: a judged item counts when the judge is at least this sure.
 * Chosen from the judge's own distribution on the first real run (2026-11-04, 620 article x ticker judgments):
 * `none` verdicts sit at 0.8 to 0.99; directional verdicts spread 0.4 to 0.89 because many articles are a headline only.
 * At 0.4 to 0.49 they are mostly recaps of results already out or loose readings; from 0.5 up they name a concrete event.
 */
export const CATALYST_MIN_PROBABILITY = 0.5;
export const JUDGE_TAG = "claude";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const DIRECTIONS: readonly string[] = ["contradicts", "continues"] satisfies CatalystDirection[];

type Candidate = {
  symbol: string;
  kind: CatalystKind;
  direction: CatalystDirection;
  eventAt: Date;
  probability: number;
  reason: string | null;
  evidence: string | null;
  item: string;
  judgmentId: string;
  sources: string[];
};

/**
 * silver.catalyst_events from every stored v3 judgment that says contradicts or continues. Items on the same
 * (ticker, direction, day) merge into one row carrying every item, judgment and source; the strongest judgment speaks.
 */
export async function rebuildSilverCatalysts(db: Db): Promise<SilverCatalystEvent[]> {
  const rows = await db
    .select()
    .from(silver.judgments)
    .where(and(inArray(silver.judgments.subjectKind, Object.values(SUBJECT_KIND)), eq(silver.judgments.questionKey, CATALYST_QUESTION_KEY)));
  const hits = rows
    .filter((j) => DIRECTIONS.includes(j.verdict))
    .map((j) => ({ j, kind: (j.subjectKind === SUBJECT_KIND.filing ? "filing" : "news") as CatalystKind, ...parseItemSubject(j.subjectId) }));
  const ids = (k: CatalystKind) => [...new Set(hits.filter((h) => h.kind === k).map((h) => h.itemId))];
  const news = ids("news").length ? await db.select().from(goldNewsItems).where(inArray(goldNewsItems.id, ids("news"))) : [];
  const filed = ids("filing").length ? await db.select().from(filings).where(inArray(filings.id, ids("filing"))) : [];
  const newsById = new Map(news.map((n) => [n.id, n]));
  const filingById = new Map(filed.map((f) => [f.id, f]));

  const candidates: Candidate[] = [];
  for (const { j, kind, symbol, itemId } of hits) {
    const n = kind === "news" ? newsById.get(itemId) : undefined;
    const f = kind === "filing" ? filingById.get(itemId) : undefined;
    if (!n && !f) continue; // the item left gold: not on the list
    candidates.push({
      symbol,
      kind,
      direction: j.verdict as CatalystDirection,
      eventAt: n ? (n.publishedAt ?? n.firstSeenAt) : f!.filedAt,
      probability: j.probability,
      reason: j.reason,
      evidence: j.citedSentence,
      item: `${kind}:${itemId}`,
      judgmentId: j.id,
      sources: [...(n ? n.sources : f!.sources), JUDGE_TAG],
    });
  }
  const events = mergeCandidates(candidates);
  await db.delete(catalystEvents);
  for (let i = 0; i < events.length; i += 500) await db.insert(catalystEvents).values(events.slice(i, i + 500));
  return events;
}

/** One event per (ticker, direction, day): every item, judgment and source kept; the strongest judgment speaks. */
export function mergeCandidates(candidates: Candidate[]): SilverCatalystEvent[] {
  const byKey = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.symbol}:${c.direction}:${dayOf(c.eventAt)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  const now = new Date();
  const idsOf = (group: Candidate[], kind: CatalystKind) => [...new Set(group.filter((c) => c.kind === kind).map((c) => c.item.slice(kind.length + 1)))];
  return [...byKey.entries()].map(([id, group]) => {
    const top = [...group].sort((a, b) => b.probability - a.probability || a.eventAt.getTime() - b.eventAt.getTime())[0];
    const eventAt = new Date(Math.min(...group.map((c) => c.eventAt.getTime())));
    return {
      id,
      symbol: top.symbol,
      kind: top.kind,
      direction: top.direction,
      eventDay: dayOf(eventAt),
      eventAt,
      probability: top.probability,
      reason: top.reason,
      evidence: top.evidence,
      topItem: top.item,
      newsItemIds: idsOf(group, "news"),
      filingIds: idsOf(group, "filing"),
      judgmentIds: group.map((c) => c.judgmentId),
      sources: [...new Set(group.flatMap((c) => c.sources))].sort(),
      lastRebuiltAt: now,
    };
  });
}

/** gold.catalysts = silver events at or above the bar, with the top item's title, link and publisher. */
export async function rebuildGoldCatalysts(db: Db, events: SilverCatalystEvent[]) {
  const kept = events.filter((e) => e.probability >= CATALYST_MIN_PROBABILITY);
  const top = (kind: CatalystKind) => [...new Set(kept.flatMap((e) => (e.topItem?.startsWith(`${kind}:`) ? [e.topItem.slice(kind.length + 1)] : [])))];
  const news = top("news").length ? await db.select().from(goldNewsItems).where(inArray(goldNewsItems.id, top("news"))) : [];
  const filed = top("filing").length ? await db.select().from(filings).where(inArray(filings.id, top("filing"))) : [];
  const now = new Date();
  const rows = kept.map((e) => {
    const n = news.find((x) => `news:${x.id}` === e.topItem);
    const f = filed.find((x) => `filing:${x.id}` === e.topItem);
    return {
      id: e.id,
      symbol: e.symbol,
      kind: e.kind,
      eventDay: e.eventDay,
      eventAt: e.eventAt,
      direction: e.direction,
      probability: e.probability,
      reason: e.reason,
      evidence: e.evidence,
      headline: n?.title ?? (f ? (f.form ? `${f.form}: ${f.title}` : f.title) : (e.evidence ?? "Untitled")),
      url: n?.url ?? f?.url ?? null,
      publisher: n?.publisher ?? f?.registry ?? null,
      newsItemIds: e.newsItemIds,
      filingIds: e.filingIds,
      sources: e.sources,
      rebuiltAt: now,
    };
  });
  await db.delete(goldCatalysts);
  for (let i = 0; i < rows.length; i += 500) await db.insert(goldCatalysts).values(rows.slice(i, i + 500));
  return rows;
}

export async function rebuildCatalysts(db: Db): Promise<PromoteResult> {
  const events = await rebuildSilverCatalysts(db);
  await rebuildGoldCatalysts(db, events);
  return { silverRowsBySource: { [JUDGE_TAG]: events.length } };
}
