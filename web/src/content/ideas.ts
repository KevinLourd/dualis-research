import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import * as content from "@/db/schema/content";
import type { IdeaRequest, IdeaScore } from "@/db/schema/content";
import { companyProfiles } from "@/db/schema/gold";
import type { Db } from "@/db/types";

/** The Ideas table shows this many days of Ideas. */
export const IDEA_WINDOW_DAYS = 14;

/** UTC day (YYYY-MM-DD). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function requestView(r: content.SilverDraftRequest): IdeaRequest {
  return { id: r.id, format: r.format, status: r.status, requestedAt: r.requestedAt.toISOString(), draftId: r.draftId, error: r.error };
}

async function requestsAndCounts(db: Db, ideaIds: string[]) {
  if (ideaIds.length === 0) return { requests: new Map<string, IdeaRequest[]>(), counts: new Map<string, number>() };
  const reqs = await db.select().from(content.contentDraftRequests).where(inArray(content.contentDraftRequests.ideaId, ideaIds)).orderBy(desc(content.contentDraftRequests.requestedAt));
  const requests = new Map<string, IdeaRequest[]>();
  for (const r of reqs) requests.set(r.ideaId, [...(requests.get(r.ideaId) ?? []), requestView(r)]);
  const drafted = await db
    .select({ ideaId: content.contentDrafts.ideaId, n: sql<number>`count(distinct ${content.contentDrafts.format})::int` })
    .from(content.contentDrafts)
    .where(inArray(content.contentDrafts.ideaId, ideaIds))
    .groupBy(content.contentDrafts.ideaId);
  return { requests, counts: new Map(drafted.map((d) => [d.ideaId!, d.n])) };
}

/** gold.content_ideas = the Ideas of the last IDEA_WINDOW_DAYS days, with their scores, requests and draft count. */
export async function rebuildGoldIdeas(db: Db, now = new Date()): Promise<number> {
  const since = utcDay(new Date(now.getTime() - IDEA_WINDOW_DAYS * 86400_000));
  const ideas = await db.select().from(content.contentIdeas).where(gte(content.contentIdeas.day, since));
  const ids = ideas.map((i) => i.id);
  const scores = ids.length ? await db.select().from(content.contentIdeaScores).where(inArray(content.contentIdeaScores.ideaId, ids)) : [];
  const byIdea = new Map<string, IdeaScore[]>();
  for (const s of scores) byIdea.set(s.ideaId, [...(byIdea.get(s.ideaId) ?? []), { format: s.format, score: s.score, why: s.why }]);
  const { requests, counts } = await requestsAndCounts(db, ids);
  const symbols = [...new Set(ideas.map((i) => i.symbol).filter((s): s is string => !!s))];
  const names = new Map(
    (symbols.length ? await db.select({ symbol: companyProfiles.symbol, name: companyProfiles.name }).from(companyProfiles).where(inArray(companyProfiles.symbol, symbols)) : []).map((r) => [r.symbol, r.name]),
  );
  const rows = ideas.map((i) => {
    const sc = (byIdea.get(i.id) ?? []).sort((a, b) => b.score - a.score);
    return {
      id: i.id,
      day: i.day,
      rank: i.rank,
      symbol: i.symbol,
      companyName: i.symbol ? (names.get(i.symbol) ?? null) : null,
      title: i.title,
      angle: i.angle,
      sourceRefs: i.sourceRefs,
      scores: sc,
      bestFormat: sc[0]?.format ?? null,
      bestScore: sc[0]?.score ?? null,
      requests: requests.get(i.id) ?? [],
      draftCount: counts.get(i.id) ?? 0,
      createdAt: i.createdAt,
    };
  });
  await db.transaction(async (tx) => {
    await tx.delete(content.goldContentIdeas);
    if (rows.length) await tx.insert(content.goldContentIdeas).values(rows);
  });
  return rows.length;
}

/** One Idea's requests and draft count changed (console button, a draft written): one UPDATE, no transaction needed. */
export async function refreshGoldIdea(db: Db, ideaId: string): Promise<void> {
  const { requests, counts } = await requestsAndCounts(db, [ideaId]);
  await db
    .update(content.goldContentIdeas)
    .set({ requests: requests.get(ideaId) ?? [], draftCount: counts.get(ideaId) ?? 0, rebuiltAt: new Date() })
    .where(eq(content.goldContentIdeas.id, ideaId));
}

/** Pending requests, oldest first (what content-drafts writes next). */
export async function pendingRequests(db: Db) {
  return db.select().from(content.contentDraftRequests).where(eq(content.contentDraftRequests.status, "pending")).orderBy(content.contentDraftRequests.requestedAt);
}
