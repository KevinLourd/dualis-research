import { and, eq, inArray } from "drizzle-orm";
import * as content from "@/db/schema/content";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { judge } from "@/llm/judge";
import type { Complete } from "@/llm/complete";

/**
 * Where one of Thierry's own published articles sits on the website's research portal (Thierry 2026-11-04:
 * "watchlist coverage / deep dives", "industry / thematic primers", a catch-all for memos and process).
 * Judged ONCE per post by Claude from its title, subtitle and opening text, stored in silver.judgments,
 * read by the gold rebuild. Bump the key to re-ask every post.
 */
export const CATEGORY_QUESTION_KEY = "research-category@v1";
export const CATEGORY_SUBJECT_KIND = "content-post";
export const RESEARCH_CATEGORIES = ["coverage", "primer", "memo"] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

const QUESTION = [
  "Which section of an equity research firm's library does this published article belong to?",
  "coverage = the article pitches or follows ONE company (a long or short idea, a deep dive on a single stock), even when it opens with a theme;",
  "primer = it explains an industry, a theme or a macro regime across many companies, with no single stock as the point;",
  "memo = anything else: a performance or portfolio update, the author's process, a short take, a housekeeping post.",
].join(" ");

/** Own Substack articles with no stored category yet get one judgment each. Notes and reference posts are never judged. */
export async function categorizeOwnArticles(db: Db, complete: Complete | undefined): Promise<number> {
  const own = (await db.select({ host: content.contentPublications.host }).from(content.contentPublications).where(eq(content.contentPublications.kind, "own"))).map(
    (p) => p.host,
  );
  if (own.length === 0) return 0;
  const posts = await db
    .select()
    .from(content.contentPosts)
    .where(and(inArray(content.contentPosts.publicationHost, own), eq(content.contentPosts.format, "substack-article")));
  if (posts.length === 0) return 0;
  const done = new Set(
    (
      await db
        .select({ subjectId: judgments.subjectId })
        .from(judgments)
        .where(and(eq(judgments.subjectKind, CATEGORY_SUBJECT_KIND), eq(judgments.questionKey, CATEGORY_QUESTION_KEY)))
    ).map((j) => j.subjectId),
  );
  const todo = posts.filter((p) => !done.has(p.id));
  if (todo.length === 0) return 0;
  if (!complete) throw new Error(`content-posts: ${todo.length} own article(s) need a research category and no LLM is set (ctx.complete)`);
  for (const p of todo) {
    await judge(
      db,
      {
        subjectKind: CATEGORY_SUBJECT_KIND,
        subjectId: p.id,
        questionKey: CATEGORY_QUESTION_KEY,
        question: QUESTION,
        input: [`Title: ${p.title}`, p.subtitle ? `Subtitle: ${p.subtitle}` : null, p.tickers.length ? `Tickers mentioned: ${p.tickers.join(", ")}` : null, p.excerpt ? `Opening text: ${p.excerpt}` : null]
          .filter(Boolean)
          .join("\n"),
        choices: RESEARCH_CATEGORIES,
      },
      complete,
    );
  }
  return todo.length;
}

/** Stored category per post id. */
export async function categoriesByPost(db: Db): Promise<Map<string, ResearchCategory>> {
  const rows = await db
    .select({ subjectId: judgments.subjectId, verdict: judgments.verdict })
    .from(judgments)
    .where(and(eq(judgments.subjectKind, CATEGORY_SUBJECT_KIND), eq(judgments.questionKey, CATEGORY_QUESTION_KEY)));
  return new Map(rows.map((r) => [r.subjectId, r.verdict as ResearchCategory]));
}
