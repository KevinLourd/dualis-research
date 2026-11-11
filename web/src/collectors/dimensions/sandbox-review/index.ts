import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as sandbox from "@/db/schema/sandbox";
import type { SandboxPostReview, SandboxSkillEdit } from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { FORMAT_NAME, MAX_ROUNDS, readSkill, shortHash, skillFile, stripFrontmatter, writingSkills } from "../sandbox-posts";
import { postKey } from "../sandbox-visuals";

/**
 * Post-evaluation of the Sandbox (Kevin 2026-11-11, skill `content-review`): once a round of an account's day has its
 * pictures, ONE call reads its 5 posts WITH their pictures and says, per post, whether the picture stands alone, the
 * text and the picture tell the same conclusion, and both read at once. When one fails it edits the WRITING skills
 * (never a post): the edits land in the skill files, the collect workflow commits them, and sandbox-posts writes the
 * day again with them (`MAX_ROUNDS`). The fix lives in what the writer reads, never in a rewrite of its text.
 * Subject `<account id>|<day>|<round>`.
 */

export const SANDBOX_REVIEW_DIMENSION = "sandbox-review";
export const CLAUDE_SOURCE = "claude";
export const REVIEW_SKILL = "content-review";
export const REVIEW_VERSION = "review-v1";

// A variable specifier: the console bundle imports this file and must not bundle node:fs (CLAUDE.md, collector runner).
const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);
const since = (now: Date) => new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);

/** Rounds whose every post has a picture drawn or failed, not reviewed yet (today and yesterday). */
export async function reviewSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  const posts = await db.select({ id: sandbox.sandboxPosts.id, accountId: sandbox.sandboxPosts.accountId, day: sandbox.sandboxPosts.day, round: sandbox.sandboxPosts.round, image: sandbox.sandboxPosts.image, visualId: sandbox.sandboxPosts.visualId }).from(sandbox.sandboxPosts).where(gte(sandbox.sandboxPosts.day, since(now)));
  const withImage = posts.filter((p) => p.image);
  if (withImage.length === 0) return [];
  const [reviews, failed] = await Promise.all([
    db.select({ accountId: sandbox.sandboxReviews.accountId, day: sandbox.sandboxReviews.day, round: sandbox.sandboxReviews.round }).from(sandbox.sandboxReviews).where(gte(sandbox.sandboxReviews.day, since(now))),
    db.select({ key: sandbox.sandboxVisuals.key }).from(sandbox.sandboxVisuals).where(and(inArray(sandbox.sandboxVisuals.key, withImage.map((p) => postKey(p.id))), eq(sandbox.sandboxVisuals.status, "failed"))),
  ]);
  const done = new Set(reviews.map((r) => `${r.accountId}|${r.day}|${r.round}`));
  const failedKeys = new Set(failed.map((f) => f.key));
  const rounds = new Map<string, typeof withImage>();
  for (const p of withImage) {
    const k = `${p.accountId}|${p.day}|${p.round}`;
    rounds.set(k, [...(rounds.get(k) ?? []), p]);
  }
  return [...rounds.entries()].filter(([k, ps]) => !done.has(k) && ps.every((p) => p.visualId || failedKeys.has(postKey(p.id)))).map(([k]) => k);
}

export function reviewSystem(reviewSkill: string): string {
  return [`You review the Sandbox posts of Dualis Research (fake accounts, nothing is published). Follow the skill ${REVIEW_SKILL} below.`, "", reviewSkill].join("\n");
}

type ReviewRequest = { version: string; skillHash: string; model: string; accountId: string; day: string; round: number; postIds: string[]; skills: string[]; prompt: string };

/** Reads the review answer. Throws with the reason. */
export function parseReview(text: string, postCount: number, skills: string[]): { posts: SandboxPostReview[]; edits: Omit<SandboxSkillEdit, "applied" | "reason">[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("review answer holds no JSON object");
  const o = JSON.parse(text.slice(start, end + 1)) as { posts?: unknown; edits?: unknown };
  if (!Array.isArray(o.posts) || o.posts.length !== postCount) throw new Error(`expected ${postCount} post reviews, got ${Array.isArray(o.posts) ? o.posts.length : "none"}`);
  const posts = (o.posts as Record<string, unknown>[]).map((p, i) => {
    for (const k of ["imageAlone", "aligned", "clear"]) if (typeof p[k] !== "boolean") throw new Error(`post review ${i + 1} has no boolean ${k}`);
    if (typeof p.why !== "string") throw new Error(`post review ${i + 1} has no why`);
    return { post: typeof p.post === "number" ? p.post : i + 1, imageAlone: p.imageAlone as boolean, aligned: p.aligned as boolean, clear: p.clear as boolean, why: p.why };
  });
  if (!Array.isArray(o.edits)) throw new Error("review answer has no edits list");
  const edits = (o.edits as Record<string, unknown>[]).map((e, i) => {
    if (typeof e.skill !== "string" || !skills.includes(e.skill)) throw new Error(`edit ${i + 1} targets ${String(e.skill)}, not one of the writer's skills (${skills.join(", ")})`);
    if (typeof e.old !== "string" || !e.old || typeof e.new !== "string" || typeof e.why !== "string") throw new Error(`edit ${i + 1} needs old, new and why`);
    return { skill: e.skill, old: e.old, new: e.new, why: e.why };
  });
  const pass = posts.every((p) => p.imageAlone && p.aligned && p.clear);
  if (!pass && edits.length === 0) throw new Error("a post fails and the review edits no skill");
  return { posts, edits };
}

export const claudeReview: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: 3,
  async fetch(subject, ctx) {
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    if (!ctx.db) throw new Error("no database in the collector context");
    const db = ctx.db;
    const [accountId, day, r] = subject.split("|");
    const round = Number(r);
    const [account] = await db.select().from(sandbox.sandboxAccounts).where(eq(sandbox.sandboxAccounts.id, accountId));
    if (!account) throw new Error(`sandbox account ${accountId} not found`);
    const posts = await db.select().from(sandbox.sandboxPosts).where(and(eq(sandbox.sandboxPosts.accountId, accountId), eq(sandbox.sandboxPosts.day, day), eq(sandbox.sandboxPosts.round, round))).orderBy(asc(sandbox.sandboxPosts.slot));
    const visuals = await db.select({ key: sandbox.sandboxVisuals.key, status: sandbox.sandboxVisuals.status, error: sandbox.sandboxVisuals.error, file: sandbox.sandboxVisuals.file, mime: sandbox.sandboxVisuals.mime }).from(sandbox.sandboxVisuals).where(inArray(sandbox.sandboxVisuals.key, posts.map((p) => postKey(p.id))));
    const skills = writingSkills(account.platform, account.tone);
    const [reviewSkill, ...writing] = await Promise.all([readSkill(REVIEW_SKILL), ...skills.map(readSkill)]);
    const images: { mime: string; data: Buffer }[] = [];
    const blocks = posts.map((p, i) => {
      const v = visuals.find((x) => x.key === postKey(p.id));
      let picture: string;
      if (v?.status === "ok" && v.file) {
        images.push({ mime: v.mime ?? "image/png", data: v.file });
        picture = `its picture is image ${images.length} above`;
      } else picture = `its picture could not be drawn (${v?.error ?? "no picture"}): that fails imageAlone`;
      return [`## Post ${i + 1}: ${FORMAT_NAME[p.format]}, angle ${p.angle}; ${picture}`, ...(p.title ? [`Title: ${p.title}`] : []), ...(p.subtitle ? [`Subtitle: ${p.subtitle}`] : []), p.text].join("\n");
    });
    const prompt = [
      `Account: « ${account.displayName} », ${account.platform === "x" ? "X" : "Substack"}, ${account.tone.toUpperCase()} tone. Day ${day}, round ${round} of ${MAX_ROUNDS}.`,
      "",
      "The writing skills it wrote with (an edit's `old` must be copied from one of them, character for character):",
      ...skills.map((n, i) => `\n=== skill ${n} ===\n${writing[i]}`),
      "",
      "Its posts:",
      ...blocks,
      "",
      `Answer with ONE JSON object only, no prose, no code fence: {"posts": [${posts.length} items, in order: {"post": <n>, "imageAlone": true|false, "aligned": true|false, "clear": true|false, "why": "<one sentence>"}], "edits": [{"skill": "<one of: ${skills.join(", ")}>", "old": "<exact text in that file>", "new": "<its replacement>", "why": "<the failure it fixes, one line>"}]}.`,
    ].join("\n");
    const { text, model } = await ctx.complete({ system: reviewSystem(stripFrontmatter(reviewSkill)), prompt, images });
    const request: ReviewRequest = { version: REVIEW_VERSION, skillHash: await shortHash(`${REVIEW_VERSION}\n${reviewSkill}`), model, accountId, day, round, postIds: posts.map((p) => p.id), skills, prompt };
    try {
      parseReview(text, posts.length, skills);
    } catch (err) {
      return { request, httpStatus: null, payloadText: text, error: `answer is not the review: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { request, httpStatus: null, payloadText: text };
  },
};

/** Applies one edit to its skill file: `old` must appear exactly once (else it is kept as not applied, with why). */
async function applyEdit(e: Omit<SandboxSkillEdit, "applied" | "reason">): Promise<SandboxSkillEdit> {
  const { readFile, writeFile } = (await nodeImport("node:fs/promises")) as typeof import("node:fs/promises");
  const file = skillFile(e.skill);
  const text = await readFile(file, "utf8");
  const count = text.split(e.old).length - 1;
  if (count !== 1) return { ...e, applied: false, reason: count === 0 ? "old text not found in the skill (it may have changed)" : `old text found ${count} times` };
  await writeFile(file, text.replace(e.old, () => e.new));
  return { ...e, applied: true, reason: null };
}

/** One silver review per round; a failed round's skill edits are written to the skill files (committed by the workflow). */
export async function promoteReviews(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE && !r.error)) {
    const req = f.request as ReviewRequest;
    const { posts, edits } = parseReview(f.payloadText ?? "", req.postIds.length, req.skills);
    const pass = posts.every((p) => p.imageAlone && p.aligned && p.clear);
    const applied: SandboxSkillEdit[] = [];
    if (!pass) for (const e of edits) applied.push(await applyEdit(e));
    for (const e of applied) console.log(`[sandbox-review] ${req.accountId} ${req.day} round ${req.round}: ${e.skill} ${e.applied ? "edited" : `not edited (${e.reason})`}: ${e.why}`);
    const inserted = await db
      .insert(sandbox.sandboxReviews)
      .values({ accountId: req.accountId, day: req.day, round: req.round, pass, posts, edits: pass ? edits.map((e) => ({ ...e, applied: false, reason: "the round passed" })) : applied, skillHash: req.skillHash, model: req.model, sources: [CLAUDE_SOURCE], bronzeIds: [f.id] })
      .onConflictDoNothing()
      .returning({ id: sandbox.sandboxReviews.id });
    n += inserted.length;
  }
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

export const sandboxReview: Dimension = {
  name: SANDBOX_REVIEW_DIMENSION,
  description: "Sandbox post-evaluation (skill content-review): each round's posts read with their pictures; a failing round edits the writing skills and is written again.",
  sources: [claudeReview],
  subjects: reviewSubjects,
  promote: promoteReviews,
};
