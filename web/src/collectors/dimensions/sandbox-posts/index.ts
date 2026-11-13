import { and, asc, eq, like, sql } from "drizzle-orm";
import { type BronzeFetch, fetches } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { DraftInputs } from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import * as sandbox from "@/db/schema/sandbox";
import type { SandboxAngle, SandboxFormat, SandboxImage, SandboxInput, SandboxPlatform } from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import { utcDay } from "@/content/ideas";
import { memo } from "../../markets";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { ideaContext } from "../content-drafts";
import { calloutPoints } from "../content-visuals/choose";
import { MIN_BARS, visualInput } from "../content-visuals/data";
import { draftPrompt, stripDashes, withDisclaimer } from "../content-drafts/format";
import { topIdeas } from "./ideas";

export { topIdeas } from "./ideas";

/**
 * Sandbox posts (Kevin 2026-11-11, skill content-matrix): every day each fake account writes 5 posts, 4 short (X post or
 * Note) + 1 Article, all on the day's best signal Ideas (Kevin 2026-11-13: « on va se focus sur nos signaux »; the
 * macro-24h, trending-format and competitor angles are gone). Every account of a channel
 * writes the same inputs in the same formats, so only the tone differs. The writer's rules are the skill files in
 * `.claude/skills/`, read at run time (never copied here): a skill edit changes the next day's posts, never a past day.
 * ONE LLM call per account per day; a rerun the same day does nothing. Never published.
 */

export const SANDBOX_POSTS_DIMENSION = "sandbox-posts";
export const CLAUDE_SOURCE = "claude";
export const POSTS_PER_DAY = 5;
/** Bump to rewrite the next day's posts with a new prompt frame; the skills' own text is hashed on top. */
export const SANDBOX_VERSION = "sandbox-v4";
/** A day is written at most this many times: the first writing + one per failed review (skill content-review). */
export const MAX_ROUNDS = 3;
/** Display times on the fake timeline: 08:00, 11:00, 14:00, 17:00, 20:00 Astana (UTC+5). */
export const SLOT_HOURS_UTC = [3, 6, 9, 12, 15] as const;

const SHORT: Record<SandboxPlatform, SandboxFormat> = { x: "x-post", substack: "substack-note" };
const ARTICLE: Record<SandboxPlatform, SandboxFormat> = { x: "x-article", substack: "substack-article" };
export const FORMAT_NAME: Record<SandboxFormat, string> = { "x-post": "X post", "x-article": "X Article", "substack-note": "Substack Note", "substack-article": "Substack Article" };

// ------------------------------------------------------------------------------------------------ skills

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);
const ANGLE_SKILLS = ["angle-signal"];

/** The repo's skills folder (`SANDBOX_SKILLS_DIR` = a copy, for tests: the reviewer edits these files). */
export function skillsRoot(): URL {
  const dir = process.env.SANDBOX_SKILLS_DIR;
  // Built at run time: webpack bundles a literal `new URL("...", import.meta.url)` as an asset (the console imports this file).
  return dir ? new URL(`file://${dir.replace(/\/?$/, "/")}`) : new URL(`${"../".repeat(5)}.claude/skills/`, import.meta.url);
}
export const skillFile = (name: string) => new URL(`${name}/SKILL.md`, skillsRoot());
export async function readSkill(name: string): Promise<string> {
  const { readFile } = (await nodeImport("node:fs/promises")) as typeof import("node:fs/promises");
  return readFile(skillFile(name), "utf8");
}
export const stripFrontmatter = (s: string) => s.replace(/^---[\s\S]*?---\s*/, "").trim();
export async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
/** The skills a channel x tone account writes with, in order: the reviewer may edit these and only these. */
export const writingSkills = (platform: SandboxPlatform, tone: string) => ["content-matrix", `${platform}-${tone}`, ...ANGLE_SKILLS];

/** The skills a channel x tone account writes with, frontmatter removed, read from the repo at run time. */
export async function loadSkills(platform: SandboxPlatform, tone: string): Promise<{ text: string; hash: string }> {
  const texts = await Promise.all(writingSkills(platform, tone).map(async (n) => stripFrontmatter(await readSkill(n))));
  const text = texts.join("\n\n---\n\n");
  return { text, hash: await shortHash(`${SANDBOX_VERSION}\n${text}`) };
}

// ------------------------------------------------------------------------------------------------ the day's plan

/** One slot of the day, shared by every account of a channel. `brief` = what the writer reads for it. */
export type SlotPlan = { slot: number; angle: SandboxAngle; article: boolean; ideaId: string | null; symbol: string | null; input: SandboxInput; brief: string; charts: ChartOption[]; news: string[] };
/** A chart the post's picture can draw: `price` or an Exhibit id, with the points its arrow can hit (id + value). */
export type ChartOption = { id: string; label: string; points: { id: string; label: string }[] };

/** The charts an Idea's post can draw (its price, the Exhibits of the drivers it cites) and the news it cites. */
async function ideaCharts(db: Db, ideaId: string): Promise<{ charts: ChartOption[]; news: string[] }> {
  const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
  if (!idea) throw new Error(`idea ${ideaId} not found`);
  const input = await visualInput(db, idea);
  const charts: ChartOption[] = [
    ...(input.bars.length >= MIN_BARS ? [{ id: "price", label: `${input.companyName ?? input.symbol} share price, last 12 months, vs fair value${input.fair ? ` ${input.fair.value} ${input.fair.currency ?? ""}`.trimEnd() : ""}`, points: calloutPoints(input, { kind: "price", reason: null }) }] : []),
    ...input.exhibits.map((e) => ({ id: e.id, label: `Exhibit of the driver « ${e.driverTitle} »: ${e.title}. ${e.takeaway}`, points: calloutPoints(input, { kind: "exhibit", exhibit: e, reason: null }) })),
  ];
  return { charts, news: input.news.map((n) => `${n.publisher}: ${n.headline}${n.citedSentence ? `. Key sentence: ${n.citedSentence}` : ""}`) };
}

/** One Idea in words (the block content-drafts hands its writer). */
async function ideaBrief(db: Db, ideaId: string): Promise<string> {
  const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
  if (!idea) throw new Error(`idea ${ideaId} not found`);
  const symbol = idea.symbol ?? idea.sourceRefs.find((r) => r.symbol)?.symbol ?? "";
  const [profile] = symbol ? await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)) : [];
  const inputs: DraftInputs = { symbol, companyName: profile?.name ?? null, news: null, worthJudgmentId: null, worth: null, thesis: null, driver: null, chart: null, idea: { id: idea.id, title: idea.title, angle: idea.angle, sources: idea.sourceRefs } };
  return draftPrompt(inputs, await ideaContext(db, idea, symbol));
}

/** The day's plan (memoized per run): the same inputs for every account. A missing input falls back to a signal Idea. */
export async function dayPlan(db: Db, platform: SandboxPlatform, day: string, ctx: SourceContext): Promise<SlotPlan[]> {
  return memo(ctx, `sandbox-plan:${platform}:${day}`, async () => {
    // An account retried later the same day writes the SAME inputs as its channel's first answer (only the tone differs).
    const [first] = await db
      .select({ request: fetches.request })
      .from(fetches)
      .where(and(eq(fetches.dimension, SANDBOX_POSTS_DIMENSION), like(fetches.subject, `${platform}:%|${day}|%`), sql`${fetches.request}->>'version' = ${SANDBOX_VERSION}`))
      .orderBy(asc(fetches.fetchedAt))
      .limit(1);
    const earlier = (first?.request as { plans?: SlotPlan[] } | undefined)?.plans;
    if (earlier?.length) return earlier;
    const ideas = await memo(ctx, "sandbox-ideas", () => topIdeas(db, SLOT_HOURS_UTC.length));
    if (ideas.length === 0) return [];
    const brief = (id: string) => memo(ctx, `sandbox-idea:${id}`, () => ideaBrief(db, id));
    const charts = (id: string) => memo(ctx, `sandbox-charts:${id}`, () => ideaCharts(db, id));
    // Signals only (Kevin 2026-11-13: « on va se focus sur nos signaux »): one distinct Idea per slot, best first.
    const plans: SlotPlan[] = [];
    for (const [slot, i] of ideas.slice(0, SLOT_HOURS_UTC.length).entries()) {
      plans.push({
        slot,
        article: false,
        ...(await charts(i.id)),
        angle: "signal",
        ideaId: i.id,
        symbol: i.symbol,
        input: { kind: "signal", label: `Idea: ${i.title}`, url: null },
        brief: `Angle: signal.\n${await brief(i.id)}`,
      });
    }
    // The Article: the day's best Idea.
    plans[0].article = true;
    return plans;
  });
}

// ------------------------------------------------------------------------------------------------ writer

/** Frame of the call; the rules themselves are the skills. */
export function sandboxSystem(skills: string, accountName: string, platform: SandboxPlatform, tone: string): string {
  return [
    `You write for the fake ${platform === "x" ? "X account" : "Substack publication"} « ${accountName} » in the ${tone.toUpperCase()} tone. It is a sandbox: nothing is published.`,
    `Follow the skills below: content-matrix, ${platform}-${tone} (the section of each post's format AND its Image section), and the angle skill of each post.`,
    "",
    skills,
  ].join("\n");
}

export function sandboxPrompt(plans: SlotPlan[], platform: SandboxPlatform): string {
  const blocks = plans.map((p) =>
    [
      `## Post ${p.slot + 1}: ${FORMAT_NAME[p.article ? ARTICLE[platform] : SHORT[platform]]}, angle ${p.angle}`,
      p.brief,
      "",
      `Charts Post ${p.slot + 1}'s picture can draw (id: what it shows; then the points its arrow can hit, id: value):`,
      ...p.charts.flatMap((c) => [`- ${c.id}: ${c.label}`, ...c.points.map((pt) => `  - ${pt.id}: ${pt.label}`)]),
      p.news.length ? `News its picture can cite (index: publisher: headline):\n${p.news.map((n, i) => `- ${i}: ${n}`).join("\n")}` : "News its picture can cite: none (newsLine and news null).",
    ].join("\n"),
  );
  const article = plans.find((p) => p.article);
  return [
    ...blocks,
    "",
    `Answer with ONE JSON object only, no prose, no code fence, no second attempt: {"posts": [...]} with exactly ${plans.length} items, one per post, each carrying its post number:`,
    `{"post": <n>, "text": "...", "image": IMAGE} for each ${FORMAT_NAME[SHORT[platform]]}${article ? `, and {"post": ${article.slot + 1}, "title": "...", "subtitle": "...", "body": "<markdown with ## headings>", "image": IMAGE} for Post ${article.slot + 1}, the ${FORMAT_NAME[ARTICLE[platform]]}` : ""}.`,
    `IMAGE = every word of that post's picture, written by you as your Image section says: {"chart": "<a chart id listed for that post>", "point": "<a point id listed under that chart>", "style": "breaking" | "pro", "title": "...", "chartLabel": "...", "note": "...", "priceSays": "...", "newsLine": "<text, or null>", "news": <null, or {"index": <a news index listed for that post>, "domain": "<that publisher's web domain>"}>}.`,
  ].join("\n\n");
}

export type ParsedPost = { title: string | null; subtitle: string | null; text: string; ticker?: string | null; image: SandboxImage };

/** Reads one post's picture: its chart and point must be listed for that post, every word present. Throws with the reason. */
export function parseImage(raw: unknown, plan: Pick<SlotPlan, "slot" | "charts" | "news">): SandboxImage {
  const n = plan.slot + 1;
  if (!raw || typeof raw !== "object") throw new Error(`post ${n} has no image`);
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`post ${n} image has no ${name}`);
    return stripDashes(v.trim());
  };
  const chart = plan.charts.find((c) => c.id === o.chart);
  if (!chart) throw new Error(`post ${n} image draws ${String(o.chart)}, not a chart listed for it`);
  const point = str(o.point, "point");
  // `latest` = the chart's last value, on any chart (the renderer resolves it; writers use it on Idea charts too).
  if (point !== "latest" && !chart.points.some((p) => p.id === point)) throw new Error(`post ${n} image points at ${point}, not a point of ${chart.id}`);
  if (o.style !== "breaking" && o.style !== "pro") throw new Error(`post ${n} image style ${String(o.style)} is not breaking or pro`);
  let news: SandboxImage["news"] = null;
  if (o.news !== null && o.news !== undefined) {
    const x = o.news as Record<string, unknown>;
    if (typeof x.index !== "number" || x.index < 0 || x.index >= plan.news.length) throw new Error(`post ${n} image cites news ${String(x.index)}, not one listed for it`);
    news = { index: x.index, domain: str(x.domain, "news domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "") };
  }
  const newsLine = typeof o.newsLine === "string" && o.newsLine.trim() ? stripDashes(o.newsLine.trim()) : null;
  if (news && !newsLine) throw new Error(`post ${n} image cites a news item with no newsLine`);
  return { chart: chart.id, point, style: o.style, title: str(o.title, "title"), chartLabel: str(o.chartLabel, "chartLabel"), note: str(o.note, "note"), priceSays: str(o.priceSays, "priceSays"), newsLine: news ? newsLine : null, news };
}

/**
 * Reads the batch answer: the LAST `{"posts": ...}` object of the text (a writer sometimes restarts its answer), one
 * item per post, matched on its `post` number (else its position); the Article must carry a title and a body.
 * Throws with the reason.
 */
export function parsePosts(text: string, plans: Pick<SlotPlan, "article" | "slot" | "charts" | "news">[]): ParsedPost[] {
  const starts = [...text.matchAll(/\{\s*"posts"/g)].map((m) => m.index!);
  const end = text.lastIndexOf("}");
  if (starts.length === 0 || end <= starts[starts.length - 1]) throw new Error("answer holds no posts object");
  const posts = (JSON.parse(text.slice(starts[starts.length - 1], end + 1)) as { posts?: unknown }).posts;
  if (!Array.isArray(posts) || posts.length !== plans.length) throw new Error(`expected ${plans.length} posts, got ${Array.isArray(posts) ? posts.length : "none"}`);
  type Item = string | { post?: unknown; text?: unknown; title?: unknown; subtitle?: unknown; body?: unknown; ticker?: unknown; image?: unknown };
  const items = posts as Item[];
  const byNumber = (n: number) => items.find((p) => typeof p === "object" && p !== null && Number(p.post) === n);
  return plans.map((plan, i) => {
    const p = byNumber(plan.slot + 1) ?? items[i];
    const o = typeof p === "string" ? { text: p } : (p ?? {});
    const ticker = typeof o.ticker === "string" && o.ticker.trim() ? o.ticker.trim().replace(/^\$/, "").toUpperCase() : null;
    const image = parseImage(typeof p === "string" ? null : o.image, plan);
    if (plan.article) {
      if (typeof o.title !== "string" || typeof (o.body ?? o.text) !== "string" || !o.title.trim() || !String(o.body ?? o.text).trim()) throw new Error(`post ${plan.slot + 1} is not an article (title, subtitle, body)`);
      return { title: stripDashes(o.title.trim()), subtitle: typeof o.subtitle === "string" && o.subtitle.trim() ? stripDashes(o.subtitle.trim()) : null, text: stripDashes(String(o.body ?? o.text).trim()), ticker, image };
    }
    const body = typeof o.text === "string" ? o.text : typeof o.body === "string" ? o.body : "";
    if (!body.trim()) throw new Error(`post ${plan.slot + 1} is empty`);
    return { title: null, subtitle: null, text: stripDashes(body.trim()), ticker, image };
  });
}

type PostsRequest = { version: string; skillHash: string; model: string; accountId: string; platform: SandboxPlatform; day: string; round: number; plans: SlotPlan[]; prompt: string };

/** One call per account per day and round: its 5 posts and their pictures. Subject `<account id>|<day>|<round>`. */
export const claudePosts: Source = {
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
    const plans = await dayPlan(db, account.platform, day, ctx);
    if (plans.length === 0) throw new Error("no Ideas to write");
    const skills = await loadSkills(account.platform, account.tone);
    const prompt = sandboxPrompt(plans, account.platform);
    const { text, model } = await ctx.complete({ system: sandboxSystem(skills.text, account.displayName, account.platform, account.tone), prompt });
    const request: PostsRequest = { version: SANDBOX_VERSION, skillHash: skills.hash, model, accountId, platform: account.platform, day, round, plans, prompt };
    const outcome = { request, httpStatus: null, payloadText: text };
    try {
      parsePosts(text, plans);
    } catch (err) {
      return { ...outcome, error: `answer is not the ${plans.length} posts: ${err instanceof Error ? err.message : String(err)}` };
    }
    return outcome;
  },
};

/**
 * Accounts with no post today (round 1), and accounts whose latest round today failed its review (skill content-review)
 * with rounds left: the day is written again with the edited skills (Kevin 2026-11-11: « relancer la génération jusqu'à
 * ce que ce soit satisfaisant »). A day written before posts carried their picture is written again too.
 */
export async function sandboxPostSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  const day = utcDay(now);
  const [accounts, written, reviews, [anyIdea]] = await Promise.all([
    db.select({ id: sandbox.sandboxAccounts.id }).from(sandbox.sandboxAccounts),
    db.select({ accountId: sandbox.sandboxPosts.accountId, round: sandbox.sandboxPosts.round, hasImage: sql<boolean>`${sandbox.sandboxPosts.image} is not null` }).from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.day, day)),
    db.select({ accountId: sandbox.sandboxReviews.accountId, round: sandbox.sandboxReviews.round, pass: sandbox.sandboxReviews.pass }).from(sandbox.sandboxReviews).where(eq(sandbox.sandboxReviews.day, day)),
    db.select({ id: content.goldContentIdeas.id }).from(content.goldContentIdeas).limit(1),
  ]);
  if (!anyIdea) return [];
  return accounts.flatMap((a) => {
    const mine = written.filter((w) => w.accountId === a.id);
    if (mine.length === 0) return [`${a.id}|${day}|1`];
    const round = Math.max(...mine.map((w) => w.round));
    const pictureless = mine.some((w) => w.round === round && !w.hasImage);
    const review = reviews.find((r) => r.accountId === a.id && r.round === round);
    return (pictureless || (review && !review.pass)) && round < MAX_ROUNDS ? [`${a.id}|${day}|${round + 1}`] : [];
  });
}

export const sandboxPosts: Dimension = {
  name: SANDBOX_POSTS_DIMENSION,
  description: "Sandbox: every fake account writes 5 posts a day (4 short + 1 Article) over 4 angles, in its tone, from the skills. Never published.",
  sources: [claudePosts],
  subjects: sandboxPostSubjects,
  promote: promoteSandboxPosts,
};

/** Bronze answer -> one silver post per (account, day, slot), stored once -> gold timeline rows of what this run wrote. */
export async function promoteSandboxPosts(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const touched: { accountId: string; day: string }[] = [];
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE && !r.error)) {
    const req = f.request as PostsRequest;
    const posts = parsePosts(f.payloadText ?? "", req.plans);
    for (const [i, post] of posts.entries()) {
      const plan = req.plans[i];
      const inserted = await db
        .insert(sandbox.sandboxPosts)
        .values({
          accountId: req.accountId,
          day: req.day,
          slot: plan.slot,
          round: req.round,
          ideaId: plan.ideaId,
          symbol: plan.symbol ?? post.ticker ?? null,
          format: plan.article ? ARTICLE[req.platform] : SHORT[req.platform],
          angle: plan.angle,
          title: post.title,
          subtitle: post.subtitle,
          text: post.text,
          input: plan.input,
          skillHash: req.skillHash,
          image: post.image,
          postAt: new Date(`${req.day}T${String(SLOT_HOURS_UTC[plan.slot]).padStart(2, "0")}:00:00Z`),
          model: req.model,
          sources: [CLAUDE_SOURCE],
          bronzeIds: [f.id],
        })
        .onConflictDoNothing()
        .returning({ id: sandbox.sandboxPosts.id });
      n += inserted.length;
    }
    touched.push({ accountId: req.accountId, day: req.day });
  }
  for (const t of touched) await rebuildGoldPosts(db, t.accountId, t.day);
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

/** gold.sandbox_posts for one account's day (the only rows a run changes), its latest round, each text as it would be published. */
export async function rebuildGoldPosts(db: Db, accountId: string, day: string) {
  const all = await db.select().from(sandbox.sandboxPosts).where(and(eq(sandbox.sandboxPosts.accountId, accountId), eq(sandbox.sandboxPosts.day, day)));
  const last = Math.max(...all.map((p) => p.round));
  const posts = all.filter((p) => p.round === last);
  if (posts.length === 0) return;
  await db.delete(sandbox.goldSandboxPosts).where(and(eq(sandbox.goldSandboxPosts.accountId, accountId), eq(sandbox.goldSandboxPosts.day, day)));
  await db.insert(sandbox.goldSandboxPosts).values(
    posts.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      day: p.day,
      slot: p.slot,
      ideaId: p.ideaId,
      symbol: p.symbol,
      format: p.format,
      angle: p.angle,
      title: p.title,
      subtitle: p.subtitle,
      text: withDisclaimer(p.format === "x-article" || p.format === "substack-article" ? "substack-article" : "x-post", p.text),
      input: p.input,
      visualId: p.visualId,
      postAt: p.postAt,
    })),
  );
}
