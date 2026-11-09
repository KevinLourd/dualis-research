import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import { refreshGoldIdea, utcDay } from "@/content/ideas";
import type { Dimension, PromoteResult, Source } from "../../types";

/**
 * The 2 posts a day (Kevin + Thierry, call 2026-11-06): each day the best scored Idea for an X post and the best for a
 * Substack Note get a draft request on their own, no click. content-drafts writes them, content-visuals draws their
 * card, content-dispatch sends each to WhatsApp with its image; « change that » rewrites, « go » publishes.
 * Articles stay Thierry's (he writes them himself): never picked here.
 */

export const PICKS_DIMENSION = "content-picks";
export const PICK_SOURCE = "auto";
/** The formats posted every day, one draft each. */
export const DAILY_FORMATS = ["x-post", "substack-note"] as const;
/** An Idea below this score is not worth a post: that format skips the day. */
export const MIN_SCORE = 50;

type Pick = { day: string; ideaId: string; format: (typeof DAILY_FORMATS)[number]; score: number; title: string };
const planned = new Map<string, Pick>();

/** The pick itself: no external call, the decision lands in bronze like any fetch. */
export const pickPlan: Source = {
  name: PICK_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject) {
    const p = planned.get(subject);
    if (!p) throw new Error(`no planned pick for ${subject}`);
    return { request: { subject }, httpStatus: null, payload: p };
  },
};

export const contentPicks: Dimension = {
  name: PICKS_DIMENSION,
  description: "The 2 posts of the day: the best scored Idea for an X post and for a Substack Note get their draft, no click needed.",
  sources: [pickPlan],
  subjects: planPicks,
  promote: promotePicks,
};

/** Formats already picked today (an auto request filed since 00:00 UTC). */
async function pickedToday(db: Db, day: string): Promise<Set<string>> {
  const rows = await db
    .select({ format: content.contentDraftRequests.format })
    .from(content.contentDraftRequests)
    .where(and(gte(content.contentDraftRequests.requestedAt, new Date(`${day}T00:00:00Z`)), sql`${PICK_SOURCE} = any(${content.contentDraftRequests.sources})`));
  return new Set(rows.map((r) => r.format));
}

/** Today's Ideas (else the latest day's), best score per daily format; two formats never share one Idea when another fits. */
export async function planPicks(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  planned.clear();
  const day = utcDay(now);
  const done = await pickedToday(db, day);
  const todo = DAILY_FORMATS.filter((f) => !done.has(f));
  if (todo.length === 0) return [];
  const [latest] = await db.select({ day: content.goldContentIdeas.day }).from(content.goldContentIdeas).orderBy(desc(content.goldContentIdeas.day)).limit(1);
  if (!latest) return [];
  const ideas = await db.select().from(content.goldContentIdeas).where(eq(content.goldContentIdeas.day, latest.day));
  const drafted = ideas.length
    ? await db
        .select({ ideaId: content.contentDraftRequests.ideaId, format: content.contentDraftRequests.format })
        .from(content.contentDraftRequests)
        .where(inArray(content.contentDraftRequests.ideaId, ideas.map((i) => i.id)))
    : [];
  const asked = new Set(drafted.map((d) => `${d.ideaId}#${d.format}`));
  const used = new Set<string>();
  const out: string[] = [];
  for (const format of todo) {
    const ranked = ideas
      .map((i) => ({ i, score: i.scores.find((s) => s.format === format)?.score ?? -1 }))
      .filter((x) => x.score >= MIN_SCORE && !asked.has(`${x.i.id}#${format}`))
      .sort((a, b) => b.score - a.score || a.i.rank - b.i.rank);
    const best = ranked.find((x) => !used.has(x.i.id)) ?? ranked[0];
    if (!best) continue;
    used.add(best.i.id);
    const key = `${day}#${format}`;
    planned.set(key, { day, ideaId: best.i.id, format, score: best.score, title: best.i.title });
    out.push(key);
  }
  return out;
}

/** Each pick -> one pending draft request (source "auto"), once a day per format. */
export async function promotePicks(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => !r.error && r.source === PICK_SOURCE)) {
    const p = f.payload as Pick;
    if ((await pickedToday(db, p.day)).has(p.format)) continue;
    const inserted = await db
      .insert(content.contentDraftRequests)
      .values({ ideaId: p.ideaId, format: p.format, sources: [PICK_SOURCE], bronzeIds: [f.id] })
      .onConflictDoNothing()
      .returning({ id: content.contentDraftRequests.id });
    if (inserted.length) n += 1;
    await refreshGoldIdea(db, p.ideaId);
  }
  return { silverRowsBySource: { [PICK_SOURCE]: n } };
}
