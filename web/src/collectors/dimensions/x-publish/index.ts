import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { fetches, type BronzeFetch } from "@/db/schema/bronze";
import { goldSandboxPosts, sandboxVisuals, type GoldSandboxPost } from "@/db/schema/sandbox";
import { goldXPublications, xPublications } from "@/db/schema/x";
import type { Db } from "@/db/types";
import { connectedHandles, seedConnections, X_API, X_ENV, xAccessToken } from "@/x/auth";
import { SHORT_DISCLAIMER } from "../content-drafts/format";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";

/**
 * Publishes the Sandbox posts of every CONNECTED X account on X, for real (Kevin 2026-11-13: « commence à poster
 * automatiquement sur notre compte X connecté (small cap) »). The account's Sandbox timeline is the queue: each post
 * goes out once its display time has passed (08:00, 11:00, 14:00, 17:00, 20:00 Astana) and its picture is drawn,
 * one post per account per run, oldest first, today's posts only (a day not posted by midnight UTC is dropped).
 * A slot already live is never posted again, even when a review round rewrites the day under new post ids.
 * An X post = its text + picture; an X Article (no API) = its title and subtitle + its cover picture.
 * Each run: refresh the token (rotated, saved first), upload the PNG, create the post. 3 failed attempts = given up.
 * Started every hour by dualis-cron (x-publish.yml, its own concurrency group).
 */

export const X_PUBLISH_DIMENSION = "x-publish";
export const X_SOURCE = "x-api";
export const MAX_ATTEMPTS = 3;

const handleOf = (accountId: string) => accountId.replace(/^x:/, "");
const slotKey = (accountId: string, day: string, slot: number) => `${accountId}|${day}|${slot}`;

/** What we send for one post: an X post as written (disclaimer included), an Article as its title and subtitle. */
export function postText(post: Pick<GoldSandboxPost, "format" | "title" | "subtitle" | "text">): string {
  if (post.format === "x-post") return post.text;
  if (post.format === "x-article") return [post.title, post.subtitle, SHORT_DISCLAIMER].filter((s): s is string => !!s?.trim()).join("\n\n");
  throw new Error(`X: a ${post.format} is not an X post`);
}

/** Today's due posts of the connected accounts, one per account (the oldest not yet live), picture drawn. */
export async function duePosts(db: Db, ctx: SourceContext, now = new Date()): Promise<string[]> {
  await seedConnections(db, ctx.env);
  const accounts = (await connectedHandles(db)).map((h) => `x:${h}`);
  if (accounts.length === 0) return [];
  const day = now.toISOString().slice(0, 10);
  const posts = await db
    .select({ id: goldSandboxPosts.id, accountId: goldSandboxPosts.accountId, slot: goldSandboxPosts.slot })
    .from(goldSandboxPosts)
    .innerJoin(sandboxVisuals, eq(sandboxVisuals.id, goldSandboxPosts.visualId))
    .where(and(inArray(goldSandboxPosts.accountId, accounts), eq(goldSandboxPosts.day, day), lte(goldSandboxPosts.postAt, now), inArray(goldSandboxPosts.format, ["x-post", "x-article"]), eq(sandboxVisuals.status, "ok"), isNotNull(sandboxVisuals.file)))
    .orderBy(asc(goldSandboxPosts.postAt), asc(goldSandboxPosts.slot));
  if (posts.length === 0) return [];
  const done = await db.select().from(xPublications).where(and(inArray(xPublications.accountId, accounts), eq(xPublications.day, day)));
  const closed = new Set(done.filter((p) => p.status === "posted" || p.attempts >= MAX_ATTEMPTS).map((p) => slotKey(p.accountId, p.day, p.slot)));
  // A post created on X whose promotion never ran (crash between the two): its bronze row is the proof, never post twice.
  const sent = await db
    .select({ request: fetches.request })
    .from(fetches)
    .where(and(eq(fetches.dimension, X_PUBLISH_DIMENSION), eq(fetches.httpStatus, 201), gte(fetches.fetchedAt, new Date(`${day}T00:00:00Z`))));
  for (const s of sent) {
    const r = s.request as { accountId?: string; day?: string; slot?: number };
    if (r.accountId && r.day && typeof r.slot === "number") closed.add(slotKey(r.accountId, r.day, r.slot));
  }
  const picked = new Map<string, string>();
  for (const p of posts) {
    if (closed.has(slotKey(p.accountId, day, p.slot)) || picked.has(p.accountId)) continue;
    picked.set(p.accountId, p.id);
  }
  return [...picked.values()];
}

async function xJson(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchFn(url, init);
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

/** Upload the picture, then create the post. The request in bronze never carries a token. */
export const xApi: Source = {
  name: X_SOURCE,
  requiredEnv: X_ENV,
  covers: () => true,
  async fetch(postId, ctx): Promise<FetchOutcome> {
    const db = ctx.db;
    if (!db) throw new Error("x-publish needs the database");
    const [post] = await db.select().from(goldSandboxPosts).where(eq(goldSandboxPosts.id, postId));
    if (!post?.visualId) throw new Error(`post ${postId} has no picture`);
    const [visual] = await db.select({ file: sandboxVisuals.file, mime: sandboxVisuals.mime }).from(sandboxVisuals).where(eq(sandboxVisuals.id, post.visualId));
    if (!visual?.file) throw new Error(`post ${postId}: picture ${post.visualId} has no file`);
    const handle = handleOf(post.accountId);
    const text = postText(post);
    const request = { postId, accountId: post.accountId, handle, day: post.day, slot: post.slot, format: post.format, text, pictureBytes: visual.file.length };

    const token = await xAccessToken(db, ctx.env, ctx.fetch, handle);
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(visual.file)], { type: visual.mime ?? "image/png" }), "picture.png");
    form.append("media_category", "tweet_image");
    const upload = await xJson(ctx.fetch, `${X_API}/2/media/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    const mediaId = (upload.body.data as { id?: string } | undefined)?.id;
    if (upload.status >= 300 || !mediaId) return { request, httpStatus: upload.status, payload: { step: "media-upload", answer: upload.body }, error: `X media upload refused (${upload.status}): ${JSON.stringify(upload.body).slice(0, 300)}` };

    const tweet = await xJson(ctx.fetch, `${X_API}/2/tweets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
    });
    const tweetId = (tweet.body.data as { id?: string } | undefined)?.id;
    if (tweet.status !== 201 || !tweetId) return { request, httpStatus: tweet.status, payload: { step: "create-post", mediaId, answer: tweet.body }, error: `X refused the post (${tweet.status}): ${JSON.stringify(tweet.body).slice(0, 300)}` };
    return { request, httpStatus: 201, payload: { tweetId, mediaId, url: `https://x.com/${handle}/status/${tweetId}` } };
  },
};

/** Bronze -> silver (one row per account x day x slot, attempts counted) -> gold (rebuilt whole: a few rows a day). */
export async function promotePublications(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => r.source === X_SOURCE)) {
    const r = f.request as { postId?: string; accountId?: string; handle?: string; day?: string; slot?: number; text?: string };
    // A fetch that died before it knew its post (missing env, no picture) has nothing to attach to: its bronze row says why.
    if (!r.postId || !r.accountId || !r.day || typeof r.slot !== "number") continue;
    const p = (f.payload ?? {}) as { tweetId?: string; mediaId?: string };
    const posted = !f.error && !!p.tweetId;
    const [old] = await db.select().from(xPublications).where(and(eq(xPublications.accountId, r.accountId), eq(xPublications.day, r.day), eq(xPublications.slot, r.slot)));
    if (old?.status === "posted") continue;
    const values = {
      postId: r.postId,
      accountId: r.accountId,
      handle: r.handle!,
      day: r.day,
      slot: r.slot,
      status: posted ? ("posted" as const) : ("failed" as const),
      tweetId: p.tweetId ?? null,
      mediaId: p.mediaId ?? null,
      text: r.text ?? null,
      error: f.error,
      attempts: (old?.attempts ?? 0) + 1,
      publishedAt: posted ? f.fetchedAt : null,
      sources: [X_SOURCE],
      bronzeIds: [...(old?.bronzeIds ?? []), f.id],
      updatedAt: new Date(),
    };
    if (old) await db.update(xPublications).set(values).where(eq(xPublications.id, old.id));
    else await db.insert(xPublications).values(values);
    n += 1;
  }
  const all = await db.select().from(xPublications);
  await db.delete(goldXPublications);
  if (all.length > 0) {
    await db.insert(goldXPublications).values(
      all.map((p) => ({
        postId: p.postId,
        accountId: p.accountId,
        handle: p.handle,
        day: p.day,
        slot: p.slot,
        status: p.status,
        tweetId: p.tweetId,
        url: p.tweetId ? `https://x.com/${p.handle}/status/${p.tweetId}` : null,
        error: p.error,
        attempts: p.attempts,
        publishedAt: p.publishedAt,
      })),
    );
  }
  return { silverRowsBySource: { [X_SOURCE]: n } };
}

export const xPublish: Dimension = {
  name: X_PUBLISH_DIMENSION,
  description: "Publishes each connected X account's Sandbox posts on X at their time, text and picture.",
  sources: [xApi],
  subjects: (db, ctx) => duePosts(db, ctx),
  promote: promotePublications,
};
