import { and, eq, isNotNull } from "drizzle-orm";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";

/**
 * gold.content_published: what Dualis put out, every channel in one list. Two inputs: Thierry's own Substack posts
 * (silver.content_posts of his publications, read from the feed) and every draft marked posted (console or WhatsApp).
 * Plain statements, no transaction: the console's Neon HTTP driver has none.
 */

type PublishedRow = typeof content.goldContentPublished.$inferInsert;

/** First line of a short post, cut at a word: the title the history shows. */
export function draftHeadline(d: { title: string | null; body: string }): string {
  if (d.title) return d.title;
  const line = d.body.split("\n").find((l) => l.trim()) ?? "";
  return line.length <= 140 ? line : `${line.slice(0, line.lastIndexOf(" ", 140) > 60 ? line.lastIndexOf(" ", 140) : 140)}…`;
}

export function publishedFromDraft(d: content.SilverContentDraft): PublishedRow {
  return {
    id: `draft:${d.id}`,
    format: d.format,
    title: draftHeadline(d),
    url: d.postedUrl,
    tickers: [d.symbol],
    publishedAt: d.statusAt,
    source: d.sources.findLast((s) => s === "console" || s === "whatsapp") ?? "console",
  };
}

export async function rebuildPublished(db: Db): Promise<number> {
  const posts = await db
    .select({ id: content.contentPosts.id, format: content.contentPosts.format, title: content.contentPosts.title, url: content.contentPosts.url, tickers: content.contentPosts.tickers, publishedAt: content.contentPosts.publishedAt })
    .from(content.contentPosts)
    .innerJoin(content.contentPublications, eq(content.contentPublications.host, content.contentPosts.publicationHost))
    .where(and(eq(content.contentPublications.kind, "own"), isNotNull(content.contentPosts.publishedAt)));
  const posted = await db.select().from(content.contentDrafts).where(eq(content.contentDrafts.status, "posted"));
  const rows: PublishedRow[] = [
    ...posts.map((p) => ({ id: `post:${p.id}`, format: p.format, title: p.title, url: p.url, tickers: p.tickers, publishedAt: p.publishedAt!, source: "substack" })),
    ...posted.map(publishedFromDraft),
  ];
  await db.delete(content.goldContentPublished);
  if (rows.length) await db.insert(content.goldContentPublished).values(rows);
  return rows.length;
}

/** A draft's status changed: it joins the history when posted, leaves it otherwise. */
export async function syncPublishedDraft(db: Db, d: content.SilverContentDraft): Promise<void> {
  const id = `draft:${d.id}`;
  if (d.status !== "posted") {
    await db.delete(content.goldContentPublished).where(eq(content.goldContentPublished.id, id));
    return;
  }
  const row = publishedFromDraft(d);
  await db.insert(content.goldContentPublished).values(row).onConflictDoUpdate({ target: content.goldContentPublished.id, set: { ...row, rebuiltAt: new Date() } });
}
