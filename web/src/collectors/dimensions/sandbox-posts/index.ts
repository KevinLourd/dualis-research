import { and, desc, eq, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { DraftInputs, VisualKind } from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import * as sandbox from "@/db/schema/sandbox";
import type { SandboxPlatform, SandboxTone } from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import { utcDay } from "@/content/ideas";
import { memo } from "../../markets";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { ideaContext } from "../content-drafts";
import { draftPrompt, FORMAT_RULES, GAME, stripDashes, withDisclaimer } from "../content-drafts/format";

/**
 * Sandbox posts (Kevin 2026-11-11): each day the top 5 Ideas, written once per fake account in its tone (X post on the
 * X accounts, Substack Note on the Substacks), so Thierry compares tones idea by idea. ONE LLM call per account per day
 * returns its 5 posts; a rerun the same day does nothing. Never published: the console's Sandbox pages show them.
 */

export const SANDBOX_POSTS_DIMENSION = "sandbox-posts";
export const CLAUDE_SOURCE = "claude";
export const POSTS_PER_DAY = 5;
export const PROMPT_VERSION = "sandbox-v1";
/** Display times on the fake timeline: 08:00, 11:00, 14:00, 17:00, 20:00 Astana (UTC+5). */
export const SLOT_HOURS_UTC = [3, 6, 9, 12, 15] as const;

const FORMAT_OF: Record<SandboxPlatform, "x-post" | "substack-note"> = { x: "x-post", substack: "substack-note" };
/** The image each platform takes from the Idea's visuals (same order as the WhatsApp post loop, content/post-image.ts). */
const VISUAL_ORDER: Record<SandboxPlatform, readonly VisualKind[]> = { x: ["x-chart", "montage"], substack: ["chart", "montage"] };

type IdeaPick = { id: string; symbol: string | null; title: string; score: number };

/** The day's top Ideas (the latest day that has some), best score on the two daily formats first, at most 5. */
export async function topIdeas(db: Db): Promise<IdeaPick[]> {
  const [latest] = await db.select({ day: content.goldContentIdeas.day }).from(content.goldContentIdeas).orderBy(desc(content.goldContentIdeas.day)).limit(1);
  if (!latest) return [];
  const ideas = await db.select().from(content.goldContentIdeas).where(eq(content.goldContentIdeas.day, latest.day));
  const best = (i: content.GoldContentIdea) => Math.max(-1, ...i.scores.filter((s) => s.format === "x-post" || s.format === "substack-note").map((s) => s.score));
  return ideas
    .map((i) => ({ i, score: best(i) }))
    .sort((a, b) => b.score - a.score || a.i.rank - b.i.rank)
    .slice(0, POSTS_PER_DAY)
    .map(({ i, score }) => ({ id: i.id, symbol: i.symbol, title: i.title, score }));
}

const TONE_RULES: Record<SandboxTone, Record<SandboxPlatform, string>> = {
  urgent: {
    x: [
      "Tone: clickbait breaking news. Open with \"🚨 BREAKING: \" then the company's short name and a colon, then ONE shock number.",
      "Make the reader feel he is late: words like \"just\", \"nobody is talking about\", \"wake up\" are welcome. One word in CAPS at most, one exclamation mark at most.",
      "Format: one X post, at most 200 characters, the ticker as a $cashtag once.",
    ].join("\n"),
    substack: [
      "Tone: clickbait breaking news. Open with \"🚨 BREAKING: \" then the company's short name and a colon, then ONE shock number.",
      "Make the reader feel he is late. One word in CAPS at most, one exclamation mark at most.",
      "Format: one Substack Note, one punchy paragraph of 2 or 3 very short sentences, 150 to 300 characters, no line breaks. A chart is attached under it.",
    ].join("\n"),
  },
  balanced: {
    // The house tone of our drafts (format.ts, skills daily-content and x-post), minus its single-answer line.
    x: FORMAT_RULES["x-post"].replace(/ ?Answer with[^.]*\./g, ""),
    substack: FORMAT_RULES["substack-note"].replace(/\n?Answer with[^.]*\./g, ""),
  },
  neutral: {
    x: [
      "Tone: sober research note. No emoji, no exclamation mark, no alarm words, no CAPS. State the fact with its number, then what it implies for the valuation, in measured words.",
      "Format: one X post, at most 260 characters, the ticker as a $cashtag once.",
    ].join("\n"),
    substack: [
      "Tone: sober research note. No emoji, no exclamation mark, no alarm words, no CAPS. State the fact with its number, then what it implies for the valuation, then what to watch next.",
      "Format: one Substack Note, one paragraph of 2 to 4 sentences, 200 to 450 characters, no line breaks, no headings. A chart is attached under it.",
    ].join("\n"),
  },
};

const BASE_NEUTRAL = [
  "You write for an independent equity research writer (small and mid caps, long/short, eight markets).",
  "The reader is a self-directed, experienced small-cap investor who reads filings.",
  "Each post tells ONE Idea, given below with the evidence behind it. One claim only: pick the single strongest fact.",
  "Plain words: subject, verb, object. Short sentences. No accounting jargon a retail investor must decode.",
  "Never write a disclaimer, it is added after you. Never invent a figure that is not in the inputs. Never an em dash or en dash, no hashtags.",
].join("\n");

/** System prompt of one account: its tone, its platform's format, and the batch answer (one post per Idea, in order). */
export function sandboxSystem(tone: SandboxTone, platform: SandboxPlatform, accountName: string, n: number): string {
  // The balanced tone IS the house prompt (format.ts GAME), without the line naming the real writer.
  const base = tone === "balanced" ? GAME.split("\n").filter((l) => !l.startsWith("You write for ")).join("\n") : BASE_NEUTRAL;
  return [
    tone === "balanced" ? "You write for an independent equity research writer (small and mid caps, long/short, eight markets)." : "",
    base,
    "",
    `Account: ${accountName}`,
    TONE_RULES[tone][platform],
    "",
    `You get ${n} Ideas, numbered. Write one post per Idea, each standing alone, in the same order.`,
    `Answer with JSON only, no prose, no code fence: {"posts": ["<post for Idea 1>", ...]} with exactly ${n} strings.`,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n")
    .trim();
}

/** Reads the batch answer: exactly `n` non-empty posts, dashes stripped. Throws with the reason. */
export function parsePosts(text: string, n: number): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("answer holds no JSON object");
  const posts = (JSON.parse(text.slice(start, end + 1)) as { posts?: unknown }).posts;
  if (!Array.isArray(posts) || posts.length !== n) throw new Error(`expected ${n} posts, got ${Array.isArray(posts) ? posts.length : "none"}`);
  return posts.map((p, i) => {
    if (typeof p !== "string" || !p.trim()) throw new Error(`post ${i + 1} is empty`);
    return stripDashes(p.trim());
  });
}

/** One Idea in words (the same block content-drafts hands its writer), read once per run for every account. */
function ideaBlock(db: Db, ctx: SourceContext, ideaId: string): Promise<string> {
  return memo(ctx, `sandbox-idea:${ideaId}`, async () => {
    const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
    if (!idea) throw new Error(`idea ${ideaId} not found`);
    const symbol = idea.symbol ?? idea.sourceRefs.find((r) => r.symbol)?.symbol ?? "";
    const [profile] = symbol ? await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)) : [];
    const inputs: DraftInputs = {
      symbol,
      companyName: profile?.name ?? null,
      news: null,
      worthJudgmentId: null,
      worth: null,
      thesis: null,
      driver: null,
      chart: null,
      idea: { id: idea.id, title: idea.title, angle: idea.angle, sources: idea.sourceRefs },
    };
    return draftPrompt(inputs, await ideaContext(db, idea, symbol));
  });
}

type PostsRequest = { promptVersion: string; model: string; accountId: string; day: string; ideas: IdeaPick[]; system: string; prompt: string };

/** One call per account per day: its 5 posts. Subject `<account id>|<day>`. */
export const claudePosts: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: 3,
  async fetch(subject, ctx) {
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    if (!ctx.db) throw new Error("no database in the collector context");
    const db = ctx.db;
    const [accountId, day] = subject.split("|");
    const [account] = await db.select().from(sandbox.sandboxAccounts).where(eq(sandbox.sandboxAccounts.id, accountId));
    if (!account) throw new Error(`sandbox account ${accountId} not found`);
    const ideas = await memo(ctx, "sandbox-top-ideas", () => topIdeas(db));
    if (ideas.length === 0) throw new Error("no Ideas to write");
    const blocks = await Promise.all(ideas.map((i) => ideaBlock(db, ctx, i.id)));
    const prompt = blocks.map((b, i) => `## Idea ${i + 1}\n${b}`).join("\n\n");
    const system = sandboxSystem(account.tone, account.platform, account.displayName, ideas.length);
    const { text, model } = await ctx.complete({ system, prompt });
    const request: PostsRequest = { promptVersion: PROMPT_VERSION, model, accountId, day, ideas, system, prompt };
    const outcome = { request, httpStatus: null, payloadText: text };
    try {
      parsePosts(text, ideas.length);
    } catch (err) {
      return { ...outcome, error: `answer is not ${ideas.length} posts: ${err instanceof Error ? err.message : String(err)}` };
    }
    return outcome;
  },
};

/** Accounts with no post today, when there are Ideas to write. */
export async function sandboxPostSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  const day = utcDay(now);
  const [accounts, done, [anyIdea]] = await Promise.all([
    db.select({ id: sandbox.sandboxAccounts.id }).from(sandbox.sandboxAccounts),
    db.selectDistinct({ accountId: sandbox.sandboxPosts.accountId }).from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.day, day)),
    db.select({ id: content.goldContentIdeas.id }).from(content.goldContentIdeas).limit(1),
  ]);
  if (!anyIdea) return [];
  const posted = new Set(done.map((d) => d.accountId));
  return accounts.filter((a) => !posted.has(a.id)).map((a) => `${a.id}|${day}`);
}

export const sandboxPosts: Dimension = {
  name: SANDBOX_POSTS_DIMENSION,
  description: "Sandbox: each day the top 5 Ideas written by every fake account in its tone (X posts, Substack Notes). Never published.",
  sources: [claudePosts],
  subjects: sandboxPostSubjects,
  promote: promoteSandboxPosts,
};

/** The Idea's image for a platform: its newest ready visual of the first kind that exists (gold, no bytes). */
async function visualFor(db: Db, ideaId: string, platform: SandboxPlatform): Promise<string | null> {
  const rows = await db
    .select({ id: content.goldContentVisuals.id, kind: content.goldContentVisuals.kind, mime: content.goldContentVisuals.mime })
    .from(content.goldContentVisuals)
    .where(and(eq(content.goldContentVisuals.ideaId, ideaId), eq(content.goldContentVisuals.status, "ok")))
    .orderBy(desc(content.goldContentVisuals.createdAt));
  for (const kind of VISUAL_ORDER[platform]) {
    const v = rows.find((r) => r.kind === kind && r.mime?.startsWith("image/"));
    if (v) return v.id;
  }
  return null;
}

/** Bronze answer -> one silver post per (account, day, slot), stored once -> gold timeline rows of what this run wrote. */
export async function promoteSandboxPosts(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const touched: { accountId: string; day: string }[] = [];
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE && !r.error)) {
    const req = f.request as PostsRequest;
    const [account] = await db.select({ platform: sandbox.sandboxAccounts.platform }).from(sandbox.sandboxAccounts).where(eq(sandbox.sandboxAccounts.id, req.accountId));
    if (!account) continue;
    const posts = parsePosts(f.payloadText ?? "", req.ideas.length);
    for (const [slot, text] of posts.entries()) {
      const idea = req.ideas[slot];
      const inserted = await db
        .insert(sandbox.sandboxPosts)
        .values({
          accountId: req.accountId,
          day: req.day,
          slot,
          ideaId: idea.id,
          symbol: idea.symbol,
          text,
          visualId: await visualFor(db, idea.id, account.platform),
          postAt: new Date(`${req.day}T${String(SLOT_HOURS_UTC[slot]).padStart(2, "0")}:00:00Z`),
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

/** gold.sandbox_posts for one account's day (the only rows a run changes), each text as it would be published. */
export async function rebuildGoldPosts(db: Db, accountId: string, day: string) {
  const [account] = await db.select({ platform: sandbox.sandboxAccounts.platform }).from(sandbox.sandboxAccounts).where(eq(sandbox.sandboxAccounts.id, accountId));
  const posts = await db.select().from(sandbox.sandboxPosts).where(and(eq(sandbox.sandboxPosts.accountId, accountId), eq(sandbox.sandboxPosts.day, day)));
  if (!account || posts.length === 0) return;
  await db.delete(sandbox.goldSandboxPosts).where(and(eq(sandbox.goldSandboxPosts.accountId, accountId), eq(sandbox.goldSandboxPosts.day, day), inArray(sandbox.goldSandboxPosts.slot, posts.map((p) => p.slot))));
  await db.insert(sandbox.goldSandboxPosts).values(
    posts.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      day: p.day,
      slot: p.slot,
      ideaId: p.ideaId,
      symbol: p.symbol,
      text: withDisclaimer(FORMAT_OF[account.platform], p.text),
      visualId: p.visualId,
      postAt: p.postAt,
    })),
  );
}
