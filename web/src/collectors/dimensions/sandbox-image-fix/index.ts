import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { type BronzeFetch, fetches } from "@/db/schema/bronze";
import * as sandbox from "@/db/schema/sandbox";
import type { SandboxImage, SandboxImageCheck } from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { FORMAT_NAME, parseImage, readSkill, shortHash, type SlotPlan, stripFrontmatter } from "../sandbox-posts";
import { postKey } from "../sandbox-visuals";

/**
 * Picture correction (Kevin 2026-11-12, skill `image-correction`: « c'est surtout une skill de correction d'image que je
 * voulais »). Once every picture of an account's round is drawn, ONE call looks at the PNGs and, per post, lists the
 * defects a reader would hit and rewrites the picture's spec (chart, point, style, every word); the corrected posts get
 * `imageVersion + 1`, sandbox-visuals draws them again, and the next pass looks again, `MAX_IMAGE_PASSES` at most. A
 * defect of the drawing code itself (« Drawing: ... ») gets no spec and is reported in the run summary.
 * Subject `<account id>|<day>|<round>`. The post review (sandbox-review) waits until the pictures are settled.
 */

export const SANDBOX_IMAGE_FIX_DIMENSION = "sandbox-image-fix";
export const CLAUDE_SOURCE = "claude";
export const IMAGE_SKILL = "image-correction";
export const IMAGE_FIX_VERSION = "image-fix-v1";
export const MAX_IMAGE_PASSES = 3;

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);
const since = (now: Date) => new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);

type RoundPost = { id: string; accountId: string; day: string; round: number; imageVersion: number; image: SandboxImage | null; visualId: string | null };

/**
 * Per round (today and yesterday): are its current pictures all drawn (or failed), how many correction passes ran, and
 * did the last one correct anything. `settled` = nothing more to correct: the post review may read the round.
 */
export async function pictureRounds(db: Db, now = new Date()) {
  const posts: RoundPost[] = await db
    .select({ id: sandbox.sandboxPosts.id, accountId: sandbox.sandboxPosts.accountId, day: sandbox.sandboxPosts.day, round: sandbox.sandboxPosts.round, imageVersion: sandbox.sandboxPosts.imageVersion, image: sandbox.sandboxPosts.image, visualId: sandbox.sandboxPosts.visualId })
    .from(sandbox.sandboxPosts)
    .where(gte(sandbox.sandboxPosts.day, since(now)));
  const withImage = posts.filter((p) => p.image);
  if (withImage.length === 0) return [];
  const [checks, failed] = await Promise.all([
    db.select({ accountId: sandbox.sandboxImageChecks.accountId, day: sandbox.sandboxImageChecks.day, round: sandbox.sandboxImageChecks.round, pass: sandbox.sandboxImageChecks.pass, posts: sandbox.sandboxImageChecks.posts }).from(sandbox.sandboxImageChecks).where(gte(sandbox.sandboxImageChecks.day, since(now))),
    db.select({ key: sandbox.sandboxVisuals.key }).from(sandbox.sandboxVisuals).where(and(inArray(sandbox.sandboxVisuals.key, withImage.map((p) => postKey(p.id, p.imageVersion))), eq(sandbox.sandboxVisuals.status, "failed"))),
  ]);
  const failedKeys = new Set(failed.map((f) => f.key));
  const rounds = new Map<string, RoundPost[]>();
  for (const p of withImage) {
    const k = `${p.accountId}|${p.day}|${p.round}`;
    rounds.set(k, [...(rounds.get(k) ?? []), p]);
  }
  return [...rounds.entries()].map(([key, ps]) => {
    const mine = checks.filter((c) => `${c.accountId}|${c.day}|${c.round}` === key).sort((a, b) => a.pass - b.pass);
    const last = mine.at(-1);
    const drawn = ps.every((p) => p.visualId || failedKeys.has(postKey(p.id, p.imageVersion)));
    const corrected = !!last && last.posts.some((x) => x.corrected);
    const settled = drawn && !!last && (!corrected || mine.length >= MAX_IMAGE_PASSES);
    return { key, posts: ps, passes: mine.length, drawn, settled };
  });
}

/** Rounds whose pictures are all drawn and still to look at: never looked at, or the last pass corrected some. */
export async function imageFixSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  return (await pictureRounds(db, now)).filter((r) => r.drawn && !r.settled && r.passes < MAX_IMAGE_PASSES).map((r) => r.key);
}

type FixRequest = { version: string; skillHash: string; model: string; accountId: string; day: string; round: number; pass: number; posts: { id: string; slot: number; plan: Pick<SlotPlan, "slot" | "charts" | "news"> }[]; prompt: string };
type FixAnswer = { post: number; ok: boolean; defects: string[]; image: SandboxImage | null };

/** Reads the correction answer: a failing post carries its corrected spec (checked like the writer's), or only « Drawing: » defects. */
export function parseFix(text: string, plans: Pick<SlotPlan, "slot" | "charts" | "news">[]): FixAnswer[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("correction answer holds no JSON object");
  const o = JSON.parse(text.slice(start, end + 1)) as { posts?: unknown };
  if (!Array.isArray(o.posts) || o.posts.length !== plans.length) throw new Error(`expected ${plans.length} pictures, got ${Array.isArray(o.posts) ? o.posts.length : "none"}`);
  return (o.posts as Record<string, unknown>[]).map((p, i) => {
    if (typeof p.ok !== "boolean") throw new Error(`picture ${i + 1} has no ok`);
    const defects = Array.isArray(p.defects) ? p.defects.filter((d): d is string => typeof d === "string") : [];
    if (p.ok) return { post: i + 1, ok: true, defects: [], image: null };
    if (defects.length === 0) throw new Error(`picture ${i + 1} fails with no defect named`);
    const drawingOnly = defects.every((d) => /^Drawing:/i.test(d));
    if (p.image === null || p.image === undefined) {
      if (!drawingOnly) throw new Error(`picture ${i + 1} fails on its spec and gives no corrected image`);
      return { post: i + 1, ok: false, defects, image: null };
    }
    return { post: i + 1, ok: false, defects, image: parseImage(p.image, plans[i]) };
  });
}

export const claudeImageFix: Source = {
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
    // The charts each post may draw: the plan its writer read (kept in the writer's bronze request).
    const [writerFetch] = await db.select({ request: fetches.request }).from(fetches).where(eq(fetches.id, posts[0].bronzeIds[0]));
    const plans = ((writerFetch?.request as { plans?: SlotPlan[] } | undefined)?.plans ?? []).filter((pl) => posts.some((p) => p.slot === pl.slot));
    if (plans.length !== posts.length) throw new Error(`the writer's plan for ${subject} is missing`);
    const visuals = await db.select({ key: sandbox.sandboxVisuals.key, status: sandbox.sandboxVisuals.status, error: sandbox.sandboxVisuals.error, file: sandbox.sandboxVisuals.file, mime: sandbox.sandboxVisuals.mime }).from(sandbox.sandboxVisuals).where(inArray(sandbox.sandboxVisuals.key, posts.map((p) => postKey(p.id, p.imageVersion))));
    const [skill, matrix, tone] = await Promise.all([readSkill(IMAGE_SKILL), readSkill("content-matrix"), readSkill(`${account.platform}-${account.tone}`)]);
    const passes = await db.select({ pass: sandbox.sandboxImageChecks.pass }).from(sandbox.sandboxImageChecks).where(and(eq(sandbox.sandboxImageChecks.accountId, accountId), eq(sandbox.sandboxImageChecks.day, day), eq(sandbox.sandboxImageChecks.round, round)));
    const pass = passes.length + 1;
    const images: { mime: string; data: Buffer }[] = [];
    const blocks = posts.map((p, i) => {
      const v = visuals.find((x) => x.key === postKey(p.id, p.imageVersion));
      let picture: string;
      if (v?.status === "ok" && v.file) {
        images.push({ mime: v.mime ?? "image/png", data: v.file });
        picture = `its picture is image ${images.length} above`;
      } else picture = `its picture could not be drawn (${v?.error ?? "no picture"}): correct the spec so it can be`;
      const plan = plans.find((pl) => pl.slot === p.slot)!;
      return [
        `## Post ${i + 1}: ${FORMAT_NAME[p.format]}; ${picture}`,
        ...(p.title ? [`Title: ${p.title}`] : []),
        p.text,
        `Its picture's spec now: ${JSON.stringify(p.image)}`,
        "Charts it may draw (id: what it shows; then its points, id: value):",
        ...plan.charts.flatMap((c) => [`- ${c.id}: ${c.label}`, ...c.points.map((pt) => `  - ${pt.id}: ${pt.label}`)]),
        plan.news.length ? `News it may cite (index: publisher: headline):\n${plan.news.map((n, k) => `- ${k}: ${n}`).join("\n")}` : "News it may cite: none (newsLine and news null).",
      ].join("\n");
    });
    const prompt = [
      `Account « ${account.displayName} », ${account.platform === "x" ? "X" : "Substack"}, ${account.tone.toUpperCase()} tone. Day ${day}, round ${round}, correction pass ${pass} of ${MAX_IMAGE_PASSES}.`,
      "",
      ...blocks,
      "",
      `Answer with ONE JSON object only, no prose, no code fence: {"posts": [${posts.length} items, in order: {"post": <n>, "ok": true|false, "defects": ["<one line each>"], "image": <null when ok or only « Drawing: » defects, else the corrected spec: {"chart", "point", "style", "title", "chartLabel", "note", "priceSays", "newsLine", "news"}>}]}.`,
    ].join("\n");
    const system = [`You correct the pictures of Dualis Research posts (a sandbox, nothing is published). Follow the skill ${IMAGE_SKILL}; the picture rules are content-matrix « The picture » and the tone's Image section.`, "", stripFrontmatter(skill), "", "=== content-matrix ===", stripFrontmatter(matrix), "", `=== ${account.platform}-${account.tone} ===`, stripFrontmatter(tone)].join("\n");
    const { text, model } = await ctx.complete({ system, prompt, images });
    const request: FixRequest = { version: IMAGE_FIX_VERSION, skillHash: await shortHash(`${IMAGE_FIX_VERSION}\n${skill}`), model, accountId, day, round, pass, posts: posts.map((p) => ({ id: p.id, slot: p.slot, plan: plans.find((pl) => pl.slot === p.slot)! })), prompt };
    try {
      parseFix(text, request.posts.map((p) => p.plan));
    } catch (err) {
      return { request, httpStatus: null, payloadText: text, error: `answer is not the correction: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { request, httpStatus: null, payloadText: text };
  },
};

/** One check row per pass; each corrected post takes its new spec and a new picture version (drawn by sandbox-visuals). */
export async function promoteImageFixes(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE && !r.error)) {
    const req = f.request as FixRequest;
    const answers = parseFix(f.payloadText ?? "", req.posts.map((p) => p.plan));
    const results: SandboxImageCheck[] = [];
    for (const [i, a] of answers.entries()) {
      const post = req.posts[i];
      if (a.image) {
        const [cur] = await db.select({ imageVersion: sandbox.sandboxPosts.imageVersion }).from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.id, post.id));
        await db.update(sandbox.sandboxPosts).set({ image: a.image, imageVersion: (cur?.imageVersion ?? 1) + 1, visualId: null }).where(eq(sandbox.sandboxPosts.id, post.id));
      }
      for (const d of a.defects.filter((x) => /^Drawing:/i.test(x))) {
        const line = `${req.accountId} ${req.day} round ${req.round}, post ${a.post}: ${d}`;
        console.warn(`[sandbox-image-fix] drawing defect: ${line}`);
        if (process.env.GITHUB_STEP_SUMMARY) {
          const { appendFile } = (await nodeImport("node:fs/promises")) as typeof import("node:fs/promises");
          await appendFile(process.env.GITHUB_STEP_SUMMARY, `- Drawing defect: ${line}\n`);
        }
      }
      results.push({ post: a.post, postId: post.id, ok: a.ok, defects: a.defects, corrected: !!a.image });
    }
    const inserted = await db
      .insert(sandbox.sandboxImageChecks)
      .values({ accountId: req.accountId, day: req.day, round: req.round, pass: req.pass, allOk: answers.every((a) => a.ok), posts: results, skillHash: req.skillHash, model: req.model, sources: [CLAUDE_SOURCE], bronzeIds: [f.id] })
      .onConflictDoNothing()
      .returning({ id: sandbox.sandboxImageChecks.id });
    n += inserted.length;
  }
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

export const sandboxImageFix: Dimension = {
  name: SANDBOX_IMAGE_FIX_DIMENSION,
  description: "Sandbox picture correction (skill image-correction): each round's drawn pictures looked at, defects listed, specs corrected and drawn again (3 passes max).",
  sources: [claudeImageFix],
  subjects: imageFixSubjects,
  promote: promoteImageFixes,
};
