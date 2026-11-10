import { asc, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema/ops";
import { goldContentAccounts, goldContentDrafts, goldContentIdeas, goldContentLibrary, goldContentPublications, goldContentVisuals, type VisualKind } from "@/db/schema/content";

/** Content section reads: gold only. */

export async function listLibrary() {
  return getDb().select().from(goldContentLibrary).orderBy(desc(goldContentLibrary.publishedAt));
}

export async function getPost(id: string) {
  const [post] = await getDb().select().from(goldContentLibrary).where(eq(goldContentLibrary.id, id));
  return post ?? null;
}

export async function listPublications() {
  return getDb().select().from(goldContentPublications).orderBy(asc(goldContentPublications.kind), asc(goldContentPublications.name));
}

/** Every draft, newest first (layout and page share one read per request). */
export const listDrafts = cache(async () => getDb().select().from(goldContentDrafts).orderBy(desc(goldContentDrafts.createdAt), asc(goldContentDrafts.symbol)));

export async function getDraft(id: string) {
  const [draft] = await getDb().select().from(goldContentDrafts).where(eq(goldContentDrafts.id, id));
  return draft ?? null;
}

export async function listAccounts() {
  return getDb().select().from(goldContentAccounts).orderBy(asc(goldContentAccounts.channel), asc(goldContentAccounts.owner), asc(goldContentAccounts.name));
}

/** Latest collector run of a content dimension (ops), so an empty page can say why it is empty. */
export async function lastContentRun(dimension: "content-posts" | "content-drafts" | "content-ideas") {
  const [run] = await getDb().select().from(runs).where(eq(runs.dimension, dimension)).orderBy(desc(runs.startedAt)).limit(1);
  return run ?? null;
}

/** The Ideas table: newest day first, best score first within a day. */
export const listIdeas = cache(async () =>
  getDb().select().from(goldContentIdeas).orderBy(desc(goldContentIdeas.day), sql`${goldContentIdeas.bestScore} desc nulls last`, asc(goldContentIdeas.rank)),
);

/**
 * Panel order: the chart first (the driver's key graph is the default visual, Thierry 2026-11-06), then the video, the
 * news capture, and the post card last (an option for once in a while).
 */
const VISUAL_ORDER: readonly VisualKind[] = ["chart", "x-chart", "video", "capture", "montage"];

/** The visuals of an Idea (latest per kind), in the order the panel shows them. */
export async function listVisuals(ideaId: string) {
  const rows = await getDb().select().from(goldContentVisuals).where(eq(goldContentVisuals.ideaId, ideaId));
  return rows.sort((a, b) => VISUAL_ORDER.indexOf(a.kind) - VISUAL_ORDER.indexOf(b.kind));
}
