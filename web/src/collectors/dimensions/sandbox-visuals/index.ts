import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { coverPng, drawChart } from "../content-visuals";
import { visualInput } from "../content-visuals/data";
import { rebuildGoldPosts } from "../sandbox-posts";

/**
 * Sandbox pictures (Kevin 2026-11-11: every sandbox post carries one). Idea posts take their Idea's chart from
 * content-visuals (`x-chart` on X, `chart` on Substack), which draws every Idea the Sandbox uses. This dimension adds:
 * - the macro-24h post's chart: its ticker's price vs fair value, in the X or the Note look (`price:<symbol>:<kind>:<day>`);
 * - every X Article's cover: its chart, whole, at X's 5:2 cover ratio (`cover:<base key>`).
 * Then it links each post of today and yesterday to its picture. Renders are content-visuals' own (drawChart, coverPng).
 */

export const SANDBOX_VISUALS_DIMENSION = "sandbox-visuals";
export const RENDER_SOURCE = "render";
const RETRY_FAILED_AFTER_MS = 20 * 3600_000;

type Kind = "chart" | "x-chart";
type Base = { kind: "content"; id: string } | { kind: "price"; key: string } | null;
type Rendered = { file: Buffer; mime: string; width: number; height: number; caption: string; kindOf: "chart" | "x-chart" | "x-cover"; symbol: string | null };
/** Files made in this run, keyed on subject: promotion stores them. */
const rendered = new Map<string, Rendered>();

const since = (now: Date) => new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
const priceKey = (symbol: string, kind: Kind, day: string) => `price:${symbol}:${kind}:${day}`;
const coverKey = (base: NonNullable<Base>) => `cover:${base.kind === "content" ? `visual:${base.id}` : base.key}`;

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

type PostRow = typeof sandbox.sandboxPosts.$inferSelect & { platform: "x" | "substack" };

/** Recent posts with their account's platform, and the macro post's ticker when the writer did not name one. */
async function recentPosts(db: Db, now: Date): Promise<PostRow[]> {
  const [posts, accounts] = await Promise.all([db.select().from(sandbox.sandboxPosts).where(gte(sandbox.sandboxPosts.day, since(now))), db.select({ id: sandbox.sandboxAccounts.id, platform: sandbox.sandboxAccounts.platform }).from(sandbox.sandboxAccounts)]);
  const platform = new Map(accounts.map((a) => [a.id, a.platform]));
  const macro = posts.filter((p) => p.angle === "macro-24h" && !p.symbol);
  let companies: { symbol: string; name: string | null }[] = [];
  if (macro.length) {
    const tickers = await db.select({ symbol: gold.tickers.symbol }).from(gold.tickers).where(eq(gold.tickers.analysed, true));
    const symbols = tickers.map((t) => t.symbol);
    companies = symbols.length ? await db.select({ symbol: gold.companyProfiles.symbol, name: gold.companyProfiles.name }).from(gold.companyProfiles).where(inArray(gold.companyProfiles.symbol, symbols)) : [];
  }
  return posts.flatMap((p) => {
    const pf = platform.get(p.accountId);
    if (!pf) return [];
    return [{ ...p, platform: pf, symbol: p.symbol ?? (p.angle === "macro-24h" ? tickerIn(`${p.title ?? ""} ${p.text}`, companies) : null) }];
  });
}

/** The newest ready content visual of an Idea for a platform (X look on X, Note look on Substack, else the card). */
async function ideaVisuals(db: Db, ideaIds: string[]) {
  if (ideaIds.length === 0) return new Map<string, { id: string; kind: string }[]>();
  const rows = await db
    .select({ id: content.goldContentVisuals.id, ideaId: content.goldContentVisuals.ideaId, kind: content.goldContentVisuals.kind, mime: content.goldContentVisuals.mime })
    .from(content.goldContentVisuals)
    .where(and(inArray(content.goldContentVisuals.ideaId, ideaIds), eq(content.goldContentVisuals.status, "ok")))
    .orderBy(desc(content.goldContentVisuals.createdAt));
  const by = new Map<string, { id: string; kind: string }[]>();
  for (const r of rows.filter((r) => r.mime?.startsWith("image/"))) by.set(r.ideaId, [...(by.get(r.ideaId) ?? []), r]);
  return by;
}
const ORDER = { x: ["x-chart", "chart", "montage"], substack: ["chart", "x-chart", "montage"] } as const;

/** Each post's base picture (before the X Article cover). */
function baseOf(p: PostRow, visuals: Map<string, { id: string; kind: string }[]>): Base {
  const kind: Kind = p.platform === "x" ? "x-chart" : "chart";
  if (p.ideaId) {
    const list = visuals.get(p.ideaId) ?? [];
    for (const k of ORDER[p.platform]) {
      const v = list.find((x) => x.kind === k);
      if (v) return { kind: "content", id: v.id };
    }
    return null;
  }
  return p.symbol ? { kind: "price", key: priceKey(p.symbol, kind, p.day) } : null;
}

async function existingKeys(db: Db, keys: string[]) {
  if (keys.length === 0) return new Map<string, typeof sandbox.sandboxVisuals.$inferSelect>();
  const rows = await db
    .select({ id: sandbox.sandboxVisuals.id, key: sandbox.sandboxVisuals.key, status: sandbox.sandboxVisuals.status, createdAt: sandbox.sandboxVisuals.createdAt })
    .from(sandbox.sandboxVisuals)
    .where(inArray(sandbox.sandboxVisuals.key, keys));
  return new Map(rows.map((r) => [r.key, r as typeof sandbox.sandboxVisuals.$inferSelect]));
}
const usable = (r: { status: string; createdAt: Date } | undefined) => !!r && (r.status === "ok" || Date.now() - r.createdAt.getTime() < RETRY_FAILED_AFTER_MS);

/** Price charts first, covers after (the runner fetches one source's subjects in order): a cover may wrap a chart made in this run. */
export async function sandboxVisualSubjects(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  rendered.clear();
  const posts = await recentPosts(db, now);
  const visuals = await ideaVisuals(db, [...new Set(posts.flatMap((p) => (p.ideaId ? [p.ideaId] : [])))]);
  const prices = new Set<string>();
  const covers = new Set<string>();
  for (const p of posts) {
    const base = baseOf(p, visuals);
    if (!base) continue;
    if (base.kind === "price") prices.add(base.key);
    if (p.format === "x-article") covers.add(coverKey(base));
  }
  const have = await existingKeys(db, [...prices, ...covers]);
  return [...[...prices].filter((k) => !usable(have.get(k))), ...[...covers].filter((k) => !usable(have.get(k)))];
}

/** The PNG of a base picture: made in this run, else stored (silver keeps the bytes). */
async function baseFile(db: Db, baseKey: string): Promise<{ file: Buffer; width: number; height: number }> {
  const made = rendered.get(baseKey);
  if (made) return made;
  if (baseKey.startsWith("visual:")) {
    const [v] = await db.select({ file: content.contentVisuals.file, width: content.contentVisuals.width, height: content.contentVisuals.height }).from(content.contentVisuals).where(eq(content.contentVisuals.id, baseKey.slice(7)));
    if (!v?.file) throw new Error(`content visual ${baseKey} has no file`);
    return { file: v.file, width: v.width ?? 1280, height: v.height ?? 720 };
  }
  const [v] = await db.select({ file: sandbox.sandboxVisuals.file, width: sandbox.sandboxVisuals.width, height: sandbox.sandboxVisuals.height }).from(sandbox.sandboxVisuals).where(and(eq(sandbox.sandboxVisuals.key, baseKey), eq(sandbox.sandboxVisuals.status, "ok")));
  if (!v?.file) throw new Error(`no picture yet for ${baseKey}`);
  return { file: v.file, width: v.width ?? 1280, height: v.height ?? 720 };
}

export const renderSource: Source = {
  name: RENDER_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject, ctx) {
    if (!ctx.db) throw new Error("no database in the collector context");
    const db = ctx.db;
    if (subject.startsWith("price:")) {
      const [, symbol, kind, day] = subject.split(":") as [string, string, Kind, string];
      // The price vs fair value chart of the ticker the macro post ties its headline to.
      const [macro] = await db.select({ input: sandbox.sandboxPosts.input }).from(sandbox.sandboxPosts).where(and(eq(sandbox.sandboxPosts.day, day), eq(sandbox.sandboxPosts.angle, "macro-24h"))).limit(1);
      const headline = macro?.input.label ?? "a macro headline";
      const idea = { id: crypto.randomUUID(), symbol, title: `What « ${headline} » means for ${symbol}`, angle: `Macro news of the day tied to ${symbol}: ${headline}`, sourceRefs: [] } as unknown as content.SilverContentIdea;
      const input = await visualInput(db, idea);
      const out = await drawChart(input, { kind: "price", reason: "the macro headline's tie to this company" }, kind, { complete: ctx.complete, fetch: ctx.fetch });
      const request = { subject, symbol, kind, closes: input.bars.length, fair: input.fair };
      if ("error" in out) return { request, httpStatus: null, error: out.error };
      rendered.set(subject, { file: out.file, mime: "image/png", width: 1280, height: 720, caption: out.caption, kindOf: kind, symbol });
      return { request: { ...request, callout: out.callout }, httpStatus: null, payload: { sizeBytes: out.file.length } };
    }
    const baseKey = subject.slice("cover:".length);
    const base = await baseFile(db, baseKey);
    const cover = await coverPng(base.file, base.width, base.height);
    rendered.set(subject, { file: cover.file, mime: "image/png", width: cover.width, height: cover.height, caption: "X Article cover", kindOf: "x-cover", symbol: null });
    return { request: { subject, base: baseKey }, httpStatus: null, payload: { sizeBytes: cover.file.length, width: cover.width, height: cover.height } };
  },
};

export const sandboxVisuals: Dimension = {
  name: SANDBOX_VISUALS_DIMENSION,
  description: "Sandbox pictures: the macro post's price vs fair value chart and every X Article's 5:2 cover; links each post to its picture.",
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
      kind: file?.kindOf ?? (f.subject.startsWith("cover:") ? ("x-cover" as const) : (f.subject.split(":")[2] as Kind)),
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

/** Every recent post -> its picture id (content visual, macro chart, or X Article cover); gold rebuilt where one moved. */
export async function linkPosts(db: Db, now = new Date()) {
  const posts = await recentPosts(db, now);
  const visuals = await ideaVisuals(db, [...new Set(posts.flatMap((p) => (p.ideaId ? [p.ideaId] : [])))]);
  const wanted = posts.map((p) => {
    const base = baseOf(p, visuals);
    return { p, base, key: base && p.format === "x-article" ? coverKey(base) : base?.kind === "price" ? base.key : null };
  });
  const have = await existingKeys(db, wanted.flatMap((w) => (w.key ? [w.key] : [])));
  const touched = new Set<string>();
  for (const { p, base, key } of wanted) {
    const hit = key ? have.get(key) : undefined;
    const id = key ? (hit?.status === "ok" ? hit.id : null) : base?.kind === "content" ? base.id : null;
    if (!id || id === p.visualId) continue;
    await db.update(sandbox.sandboxPosts).set({ visualId: id, symbol: p.symbol }).where(eq(sandbox.sandboxPosts.id, p.id));
    touched.add(`${p.accountId}|${p.day}`);
  }
  for (const t of touched) {
    const [accountId, day] = t.split("|");
    await rebuildGoldPosts(db, accountId, day);
  }
}
