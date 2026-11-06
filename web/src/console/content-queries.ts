import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema/ops";
import { goldContentAccounts, goldContentDrafts, goldContentLibrary, goldContentPublications } from "@/db/schema/content";

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

export async function listDrafts() {
  return getDb().select().from(goldContentDrafts).orderBy(desc(goldContentDrafts.createdAt), asc(goldContentDrafts.symbol));
}

export async function getDraft(id: string) {
  const [draft] = await getDb().select().from(goldContentDrafts).where(eq(goldContentDrafts.id, id));
  return draft ?? null;
}

export async function listAccounts() {
  return getDb().select().from(goldContentAccounts).orderBy(asc(goldContentAccounts.channel), asc(goldContentAccounts.owner), asc(goldContentAccounts.name));
}

/** Latest collector run of a content dimension (ops), so an empty page can say why it is empty. */
export async function lastContentRun(dimension: "content-posts" | "content-drafts") {
  const [run] = await getDb().select().from(runs).where(eq(runs.dimension, dimension)).orderBy(desc(runs.startedAt)).limit(1);
  return run ?? null;
}
