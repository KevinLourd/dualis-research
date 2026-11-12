import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { coverPng, drawCallout, drawOpportunity } from "../content-visuals";
import { opportunityStory } from "../content-visuals/opportunity";
import type { ChartChoice } from "../content-visuals/choose";
import { visualInput, type VisualInput } from "../content-visuals/data";
import { rebuildGoldPosts } from "../sandbox-posts";

/**
 * Sandbox pictures (Kevin 2026-11-11): every post gets ITS OWN picture, drawn from the image its writer specified in the
 * same call as the text (`SandboxImage`: chart, point, style and every word), so each tone's skill shapes its images and
 * the picture says the post's conclusion. The code only draws (content-visuals' `drawCallout`, `coverPng`): an X Article's
 * picture is its chart, whole, at X's 5:2 cover ratio. Key `post:<post id>`; then each post is linked to its picture.
 */

export const SANDBOX_VISUALS_DIMENSION = "sandbox-visuals";
export const RENDER_SOURCE = "render";
const RETRY_FAILED_AFTER_MS = 20 * 3600_000;

type Rendered = { file: Buffer; mime: string; width: number; height: number; caption: string; kindOf: "chart" | "x-chart" | "x-cover"; symbol: string | null };
/** Files made in this run, keyed on subject: promotion stores them. */
const rendered = new Map<string, Rendered>();

const since = (now: Date) => new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
/**
 * Bump when the drawing code changes what a picture looks like: the pictures of today and yesterday are drawn again
 * (render only, no Claude call). 2 = 2026-11-12, the defects image-correction found (ring on the end value, note boxes).
 */
export const DRAW_VERSION = 4;
/** A post's picture key: `post:<id>[:v<n> once corrected n-1 times]:d<drawing code version>`. */
export const postKey = (postId: string, version = 1) => `post:${postId}${version > 1 ? `:v${version}` : ""}:d${DRAW_VERSION}`;

/** The covered company a post names: `$SYM`, `(SYM)`, the symbol, or the first word of its name; first in the text wins. */
export function tickerIn(text: string, companies: { symbol: string; name: string | null }[]): string | null {
  let best: { symbol: string; at: number } | null = null;
  for (const c of companies) {
    const word = (c.name ?? "").split(/\s+/)[0]?.replace(/[^\w&'-]/g, "") ?? "";
    const pats = [`\\$${c.symbol.replace(/\./g, "\\.")}\\b`, `\\b${c.symbol.replace(/\./g, "\\.")}\\b`, ...(word.length >= 4 ? [`\\b${word}\\b`] : [])];
    for (const p of pats) {
      const m = new RegExp(p).exec(text);
      if (m && (!best || m.index < best.at)) best = { symbol: c.symbol, at: m.index };
    }
  }
  return best?.symbol ?? null;
}

/** Recent posts that specified a picture and have none at their current spec and drawing code version. */
async function postsToDraw(db: Db, now: Date) {
  const posts = await db
    .select()
    .from(sandbox.sandboxPosts)
    .where(and(gte(sandbox.sandboxPosts.day, since(now)), isNotNull(sandbox.sandboxPosts.image)));
  const linked = posts.flatMap((p) => (p.visualId ? [p.visualId] : []));
  const keys = new Map(linked.length ? (await db.select({ id: sandbox.sandboxVisuals.id, key: sandbox.sandboxVisuals.key }).from(sandbox.sandboxVisuals).where(inArray(sandbox.sandboxVisuals.id, linked))).map((v) => [v.id, v.key]) : []);
  return posts.filter((p) => !p.visualId || keys.get(p.visualId) !== postKey(p.id, p.imageVersion));
}

async function existingKeys(db: Db, keys: string[]) {
  if (keys.length === 0) return new Map<string, { id: string; status: string; createdAt: Date }>();
  const rows = await db.select({ id: sandbox.sandboxVisuals.id, key: sandbox.sandboxVisuals.key, status: sandbox.sandboxVisuals.status, createdAt: sandbox.sandboxVisuals.createdAt }).from(sandbox.sandboxVisuals).where(inArray(sandbox.sandboxVisuals.key, keys));
  return new Map(rows.map((r) => [r.key, r]));
}
const usable = (r: { status: string; createdAt: Date } | undefined) => !!r && (r.status === "ok" || Date.now() - r.createdAt.getTime() < RETRY_FAILED_AFTER_MS);

export async function sandboxVisualSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  rendered.clear();
  const keys = (await postsToDraw(db, now)).map((p) => postKey(p.id, p.imageVersion));
  const have = await existingKeys(db, keys);
  return keys.filter((k) => !usable(have.get(k)));
}

/** What a post's chart is drawn from: its Idea's gold numbers, or (macro post) the price of the company it ties the headline to. */
async function inputOf(db: Db, post: typeof sandbox.sandboxPosts.$inferSelect): Promise<{ input: VisualInput; symbol: string }> {
  if (post.ideaId) {
    const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, post.ideaId));
    if (!idea) throw new Error(`idea ${post.ideaId} not found`);
    const input = await visualInput(db, idea);
    return { input, symbol: input.symbol };
  }
  let symbol = post.symbol;
  if (!symbol) {
    const tickers = await db.select({ symbol: gold.tickers.symbol }).from(gold.tickers).where(eq(gold.tickers.analysed, true));
    const companies = tickers.length ? await db.select({ symbol: gold.companyProfiles.symbol, name: gold.companyProfiles.name }).from(gold.companyProfiles).where(inArray(gold.companyProfiles.symbol, tickers.map((t) => t.symbol))) : [];
    symbol = tickerIn(`${post.title ?? ""} ${post.text}`, companies);
  }
  if (!symbol) throw new Error("the macro post names no covered company to chart");
  const idea = { id: crypto.randomUUID(), symbol, title: `What « ${post.input.label} » means for ${symbol}`, angle: `Macro news of the day tied to ${symbol}: ${post.input.label}`, sourceRefs: [] } as unknown as content.SilverContentIdea;
  return { input: await visualInput(db, idea), symbol };
}

export const renderSource: Source = {
  name: RENDER_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject, ctx) {
    if (!ctx.db) throw new Error("no database in the collector context");
    const db = ctx.db;
    const [post] = await db.select().from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.id, subject.split(":")[1]));
    if (!post?.image) return { request: { subject }, httpStatus: null, error: "post not found, or it specified no picture" };
    const image = post.image;
    const request = { subject, image };
    const { input, symbol } = await inputOf(db, post);
    // The frame of every account (Kevin 2026-11-12): the narrative and its 1-3 drivers reversing now, one chart each.
    // Only when no driver of the ticker reverses does the writer's own chart stand in.
    const story = await opportunityStory(db, symbol, ctx.complete);
    if (story) {
      const pic = await drawOpportunity(story);
      if (post.format === "x-article") {
        const cover = await coverPng(pic.file, pic.width, pic.height);
        rendered.set(subject, { file: cover.file, mime: "image/png", width: cover.width, height: cover.height, caption: pic.caption, kindOf: "x-cover", symbol });
      } else rendered.set(subject, { file: pic.file, mime: "image/png", width: pic.width, height: pic.height, caption: pic.caption, kindOf: "chart", symbol });
      return { request: { ...request, opportunity: story.drivers.map((d) => `${d.title}: ${d.tag}`) }, httpStatus: null, payload: { sizeBytes: rendered.get(subject)!.file.length, symbol } };
    }
    let choice: ChartChoice;
    if (image.chart === "price") choice = { kind: "price", reason: null };
    else {
      const exhibit = input.exhibits.find((e) => e.id === image.chart);
      if (!exhibit) return { request, httpStatus: null, error: `exhibit ${image.chart} is no longer one of the Idea's` };
      choice = { kind: "exhibit", exhibit, reason: null };
    }
    // `latest` = the last value of the chart (the macro writer cannot see the points of a company it has not named yet).
    const lead = choice.kind === "exhibit" ? choice.exhibit.series[0].key : null;
    const point = image.point !== "latest" ? image.point : choice.kind === "exhibit" ? choice.exhibit.points.filter((p) => typeof p.values[lead!] === "number").at(-1)?.period : input.bars.at(-1)?.date;
    if (!point) return { request, httpStatus: null, error: `${symbol} has no data to draw` };
    if (choice.kind === "price" && input.bars.length < 2) return { request, httpStatus: null, error: `${symbol} has no closes to draw` };
    const chart = await drawCallout(input, choice, image.style, { point, note: image.note, title: image.title, chartLabel: image.chartLabel, priceSays: image.priceSays, newsLine: image.newsLine, news: image.news }, ctx.fetch);
    const kindOf = image.style === "pro" ? ("x-chart" as const) : ("chart" as const);
    if (post.format === "x-article") {
      const cover = await coverPng(chart.file, 1280, 720);
      rendered.set(subject, { file: cover.file, mime: "image/png", width: cover.width, height: cover.height, caption: chart.caption, kindOf: "x-cover", symbol });
    } else rendered.set(subject, { file: chart.file, mime: "image/png", width: 1280, height: 720, caption: chart.caption, kindOf, symbol });
    return { request, httpStatus: null, payload: { sizeBytes: rendered.get(subject)!.file.length, symbol } };
  },
};

export const sandboxVisuals: Dimension = {
  name: SANDBOX_VISUALS_DIMENSION,
  description: "Sandbox pictures: each post's own chart, drawn from the image its writer specified (X Articles at the 5:2 cover ratio); links each post to it.",
  sources: [renderSource],
  subjects: sandboxVisualSubjects,
  promote: promoteSandboxVisuals,
};

/** Store this run's files, then point every recent post at its picture and rebuild the gold rows that changed. */
export async function promoteSandboxVisuals(db: Db, rows: BronzeFetch[], _ctx?: unknown, now = new Date()): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => r.source === RENDER_SOURCE)) {
    const file = rendered.get(f.subject);
    const ok = !f.error && !!file;
    const row = {
      key: f.subject,
      kind: file?.kindOf ?? ("chart" as const),
      symbol: file?.symbol ?? null,
      status: (ok ? "ok" : "failed") as "ok" | "failed",
      error: ok ? null : (f.error ?? "the file was not kept by this run"),
      mime: file?.mime ?? null,
      width: file?.width ?? null,
      height: file?.height ?? null,
      file: ok ? file!.file : null,
      sizeBytes: file?.file.length ?? null,
      caption: file?.caption ?? null,
      sources: [RENDER_SOURCE],
      bronzeIds: [f.id],
      createdAt: new Date(),
    };
    await db.insert(sandbox.sandboxVisuals).values(row).onConflictDoUpdate({ target: sandbox.sandboxVisuals.key, set: row });
    n += ok ? 1 : 0;
  }
  await linkPosts(db, now);
  return { silverRowsBySource: { [RENDER_SOURCE]: n } };
}

/** Every recent post without a picture -> its drawn picture; gold rebuilt where one moved. */
export async function linkPosts(db: Db, now = new Date()) {
  const posts = await postsToDraw(db, now);
  const have = await existingKeys(db, posts.map((p) => postKey(p.id, p.imageVersion)));
  const touched = new Set<string>();
  for (const p of posts) {
    const hit = have.get(postKey(p.id, p.imageVersion));
    if (hit?.status !== "ok") continue;
    await db.update(sandbox.sandboxPosts).set({ visualId: hit.id }).where(eq(sandbox.sandboxPosts.id, p.id));
    touched.add(`${p.accountId}|${p.day}`);
  }
  for (const t of touched) {
    const [accountId, day] = t.split("|");
    await rebuildGoldPosts(db, accountId, day);
  }
}
