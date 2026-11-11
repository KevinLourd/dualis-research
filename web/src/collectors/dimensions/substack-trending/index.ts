import { desc, gte, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import { getJson } from "../../http";
import type { Dimension, PromoteResult, Source } from "../../types";
import { REFERENCE_PUBLICATIONS } from "../content-posts";
import { SEED_HOSTS } from "../substack-network/seeds";

/**
 * What performs right now on finance Substacks (Kevin 2026-11-11, angle trending-format of skill content-matrix): each
 * publication's public archive JSON (`/api/v1/archive?sort=new`), read on its OWN domain (Substack's Cloudflare blocks
 * *.substack.com from GitHub Actions). Bronze = the raw answer; silver = one row per post with its engagement as last
 * read; gold = the 30 best of the last 30 days (reactions + 2 x restacks + comments). Notes have no public archive.
 */

export const SUBSTACK_TRENDING_DIMENSION = "substack-trending";
export const SUBSTACK_SOURCE = "substack";
const WINDOW_DAYS = 30;
const TOP = 30;

/** Custom-domain publications we follow (targets + references). */
export const TRENDING_HOSTS: readonly string[] = [...new Set([...SEED_HOSTS, ...REFERENCE_PUBLICATIONS.map((p) => p.host)])].filter((h) => !h.endsWith(".substack.com"));
const NAMES = new Map<string, string>(REFERENCE_PUBLICATIONS.map((p) => [p.host, p.name]));

export const substackArchive: Source = {
  name: SUBSTACK_SOURCE,
  requiredEnv: [],
  covers: (host) => !host.endsWith(".substack.com"),
  fetch: (host, ctx) => getJson(ctx, `https://${host}/api/v1/archive?sort=new&limit=12`, { host }, { headers: { "user-agent": "DualisResearch/1.0" } }),
};

export const substackTrending: Dimension = {
  name: SUBSTACK_TRENDING_DIMENSION,
  description: "Best performing recent posts of the finance Substacks we follow, for the Sandbox's trending-format angle.",
  sources: [substackArchive],
  subjects: async () => [...TRENDING_HOSTS],
  promote: promoteTrending,
};

type ArchivePost = {
  canonical_url?: string;
  title?: string;
  subtitle?: string | null;
  post_date?: string;
  audience?: string;
  wordcount?: number;
  reaction_count?: number;
  restacks?: number;
  comment_count?: number;
  type?: string;
};

/** The archive answers either a list or `{ posts, nextCursor }`. */
function postsOf(payload: unknown): ArchivePost[] {
  if (Array.isArray(payload)) return payload as ArchivePost[];
  const posts = (payload as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) throw new Error("archive answer holds no posts");
  return posts as ArchivePost[];
}

export const trendScore = (p: { reactions: number; restacks: number; comments: number }) => p.reactions + 2 * p.restacks + p.comments;

export async function promoteTrending(db: Db, fetches: BronzeFetch[], _ctx?: unknown, now = new Date()): Promise<PromoteResult> {
  let n = 0;
  for (const f of fetches.filter((r) => r.source === SUBSTACK_SOURCE && !r.error)) {
    for (const p of postsOf(f.payload)) {
      if (!p.canonical_url || !p.title || !p.post_date || (p.type && p.type !== "newsletter")) continue;
      const row = {
        url: p.canonical_url,
        host: f.subject,
        publicationName: NAMES.get(f.subject) ?? null,
        title: p.title,
        subtitle: p.subtitle ?? null,
        postDate: new Date(p.post_date),
        audience: p.audience ?? null,
        wordcount: p.wordcount ?? null,
        reactions: p.reaction_count ?? 0,
        restacks: p.restacks ?? 0,
        comments: p.comment_count ?? 0,
        sources: [SUBSTACK_SOURCE],
        bronzeIds: [f.id],
        updatedAt: now,
      };
      await db.insert(sandbox.substackTrendingPosts).values(row).onConflictDoUpdate({ target: sandbox.substackTrendingPosts.url, set: row });
      n += 1;
    }
  }
  await rebuildGoldTrending(db, now);
  return { silverRowsBySource: { [SUBSTACK_SOURCE]: n } };
}

/** gold.substack_trending = the best posts of the last 30 days. */
export async function rebuildGoldTrending(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400_000);
  const rows = await db.select().from(sandbox.substackTrendingPosts).where(gte(sandbox.substackTrendingPosts.postDate, since)).orderBy(desc(sandbox.substackTrendingPosts.postDate));
  const top = rows
    .map((r) => ({ r, score: trendScore(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP);
  await db.delete(sandbox.goldSubstackTrending);
  if (top.length === 0) return;
  await db.insert(sandbox.goldSubstackTrending).values(
    top.map(({ r, score }, i) => ({ url: r.url, rank: i + 1, host: r.host, publicationName: r.publicationName, title: r.title, subtitle: r.subtitle, postDate: r.postDate, audience: r.audience, wordcount: r.wordcount, score, reactions: r.reactions, restacks: r.restacks, comments: r.comments })),
  );
}

/** The top few trending posts, best first (the Sandbox writer reads the first). */
export async function topTrending(db: Db, limit = 3) {
  const rows = await db.select().from(sandbox.goldSubstackTrending).where(inArray(sandbox.goldSubstackTrending.rank, Array.from({ length: limit }, (_, i) => i + 1)));
  return rows.sort((a, b) => a.rank - b.rank);
}
