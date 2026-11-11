import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { macroNews, MACRO_QUERIES } from "../macro-news";
import { SANDBOX_ACCOUNTS, sandboxAccounts } from "../sandbox-accounts";
import { substackTrending, TRENDING_HOSTS } from "../substack-trending";
import { articleAngle, loadSkills, parsePosts, POSTS_PER_DAY, sandboxPosts } from ".";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

let db: Db;
let close: () => Promise<void>;
const ideaIds: string[] = [];

async function addIdea(rank: number, score: number) {
  const [idea] = await db
    .insert(content.contentIdeas)
    .values({ generationBronzeId: crypto.randomUUID(), rank, day: new Date().toISOString().slice(0, 10), symbol: "CCLD", title: `Idea ${rank}`, angle: "a", sourceRefs: [], model: "fake", sources: ["claude"], bronzeIds: [] })
    .returning();
  const scores = [{ format: "x-post", score, why: "w" }, { format: "substack-note", score: score - 5, why: "w" }];
  await db.insert(content.goldContentIdeas).values({ ...idea, companyName: "CareCloud", scores, bestFormat: "x-post", bestScore: score, requests: [], draftCount: 0 });
  return idea.id;
}

/** Fake Claude: one JSON item per « ## Post », an object for the Article. */
const complete = vi.fn<Complete>(async ({ system, prompt }) => {
  const heads = [...prompt.matchAll(/^## Post \d+: ([^,]+), angle (\S+)/gm)];
  const tone = /in the URGENT tone/.test(system) ? "urgent" : /in the NEUTRAL tone/.test(system) ? "neutral" : "balanced";
  const posts = heads.map(([, format, angle], i) => (/Article/.test(format) ? { title: `${tone} article ${angle}`, subtitle: "Sub", body: "## What happened\n\nCareCloud — profit up.\n\n- one\n- two" } : `${tone} ${angle} post ${i + 1} — $CCLD`));
  return { text: JSON.stringify({ posts }), model: "fake" };
});
const rss = (items: { title: string; link: string; hours: number }[]) =>
  `<rss><channel>${items.map((i) => `<item><title>${i.title} - Reuters</title><link>${i.link}</link><pubDate>${hoursAgo(i.hours).toUTCString()}</pubDate><source>Reuters</source></item>`).join("")}</channel></rss>`;
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "news.google.com") {
    const q = url.searchParams.get("q") ?? "";
    return new Response(rss([{ title: "Fed holds rates", link: "https://www.reuters.com/fed", hours: 2 }, ...(q.startsWith("oil") ? [{ title: "Oil jumps", link: "https://www.reuters.com/oil", hours: 3 }, { title: "Old", link: "https://x.com/old", hours: 40 }] : [])]));
  }
  if (url.pathname === "/api/v1/archive") {
    return Response.json({
      posts: [
        { canonical_url: `https://${url.hostname}/p/a`, title: `Top of ${url.hostname}`, post_date: hoursAgo(48).toISOString(), reaction_count: url.hostname.length, restacks: 1, comment_count: 2, type: "newsletter", wordcount: 2000 },
        { canonical_url: `https://${url.hostname}/p/old`, title: "Old", post_date: hoursAgo(24 * 90).toISOString(), reaction_count: 999, restacks: 0, comment_count: 0, type: "newsletter" },
      ],
    });
  }
  return new Response("no", { status: 404 });
}) as typeof fetch;
const ctx = { env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch: fakeFetch, complete };
const run = (d: Parameters<typeof runDimension>[1]) => runDimension(db, d, { trigger: "test", ctx });

beforeEach(async () => {
  ({ db, close } = await testDb());
  complete.mockClear();
  ideaIds.length = 0;
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  for (const [rank, score] of [[1, 90], [2, 40], [3, 80], [4, 70], [5, 60], [6, 50]] as const) ideaIds.push(await addIdea(rank, score));
  const [v] = await db.insert(content.contentVisuals).values({ ideaId: ideaIds[0], kind: "x-chart", version: "v", status: "ok", mime: "image/png", file: PNG, sizeBytes: PNG.length, sources: ["render"], bronzeIds: [] }).returning();
  await db.insert(content.goldContentVisuals).values({ id: v.id, ideaId: ideaIds[0], kind: "x-chart", status: "ok", mime: "image/png", createdAt: new Date() });
  // A reference publication's recent post (content-posts) for the competitor angle.
  await db.insert(content.contentPublications).values({ host: "www.citriniresearch.com", name: "Citrini Research", kind: "reference", sources: ["rss"], bronzeIds: [] });
  await db.insert(content.contentPosts).values({ urlKey: "citrini/p/x", url: "https://www.citriniresearch.com/p/x", publicationHost: "www.citriniresearch.com", format: "substack-article", title: "A primer on shipping", excerpt: "Shipping is a cycle.", publishedAt: hoursAgo(72), topics: [], tickers: [], tickersBySource: {}, sources: ["rss"], bronzeIds: [] });
});
afterEach(async () => close());

describe("sandbox-accounts", () => {
  it("lands the 6 seed accounts in silver and gold, each X account paired with its Substack", async () => {
    await run(sandboxAccounts);
    await run(sandboxAccounts);
    const accounts = await db.select().from(sandbox.goldSandboxAccounts);
    expect(accounts).toHaveLength(6);
    expect(new Set(accounts.map((a) => `${a.platform}:${a.tone}`)).size).toBe(6);
    for (const a of accounts) expect(accounts.find((b) => b.id === a.pairedAccountId)?.tone).toBe(a.tone);
    expect(accounts.filter((a) => a.platform === "x").every((a) => a.bio.includes(".substack.com"))).toBe(true);
    expect(SANDBOX_ACCOUNTS.some((a) => /thierry|quantum_macro/i.test(`${a.handle} ${a.author} ${a.bio}`))).toBe(false);
  });
});

describe("macro-news and substack-trending", () => {
  it("macro: one row per article with every search that found it; gold keeps the last 24 h", async () => {
    await run(macroNews);
    const items = await db.select().from(sandbox.macroNewsItems);
    expect(items.map((i) => i.title).sort()).toEqual(["Fed holds rates", "Oil jumps"]);
    expect(items.find((i) => i.title === "Fed holds rates")?.queries).toHaveLength(MACRO_QUERIES.length);
    expect(await db.select().from(sandbox.goldMacroNews)).toHaveLength(2);
  });

  it("trending: the best recent posts of the last 30 days, scored", async () => {
    await run(substackTrending);
    const gold = await db.select().from(sandbox.goldSubstackTrending);
    expect(gold).toHaveLength(TRENDING_HOSTS.length);
    expect(gold.every((g) => g.title !== "Old" && g.score === g.reactions + 2 * g.restacks + g.comments)).toBe(true);
  });
});

describe("sandbox-posts", () => {
  it("5 posts per account per day: 4 short + 1 Article, all 4 angles, same inputs per channel; a rerun does nothing", async () => {
    await run(macroNews);
    await run(substackTrending);
    await run(sandboxAccounts);
    expect((await run(sandboxPosts)).status).toBe("succeeded");
    expect(complete).toHaveBeenCalledTimes(6);
    const posts = await db.select().from(sandbox.goldSandboxPosts);
    expect(posts).toHaveLength(6 * POSTS_PER_DAY);
    const accounts = await db.select().from(sandbox.goldSandboxAccounts);
    for (const a of accounts) {
      const mine = posts.filter((p) => p.accountId === a.id).sort((x, y) => x.slot - y.slot);
      expect(new Set(mine.map((p) => p.angle))).toEqual(new Set(["signal", "macro-24h", "trending-format", "competitor"]));
      expect(mine.filter((p) => p.format.endsWith("article"))).toHaveLength(1);
      expect(mine.filter((p) => p.format === (a.platform === "x" ? "x-post" : "substack-note"))).toHaveLength(4);
      const article = mine.find((p) => p.format.endsWith("article"))!;
      expect(article.angle).toBe(articleAngle(article.day));
      expect(article.title).toMatch(/article/);
    }
    // Same inputs for every account of a channel.
    for (const platform of ["x", "substack"]) {
      const ids = accounts.filter((a) => a.platform === platform).map((a) => a.id);
      const inputs = ids.map((id) => JSON.stringify(posts.filter((p) => p.accountId === id).sort((x, y) => x.slot - y.slot).map((p) => [p.format, p.angle, p.input.label])));
      expect(new Set(inputs).size).toBe(1);
    }
    // The macro slot names its headline; Substack's trending slot names the post it borrows the shape from.
    expect(posts.find((p) => p.angle === "macro-24h")?.input.url).toBe("https://www.reuters.com/fed");
    expect(posts.find((p) => p.accountId.startsWith("substack:") && p.angle === "trending-format")?.input.url).toMatch(/\/p\/a$/);
    expect(posts.find((p) => p.angle === "competitor")?.input.label).toMatch(/A primer on shipping/);
    // Dashes stripped, disclaimer, staggered times; the best Idea's chart (the only one drawn) on its posts, none on the macro post.
    expect(posts.every((p) => !p.text.includes("—") && /Not investment advice/.test(p.text))).toBe(true);
    expect(new Set(posts.map((p) => p.postAt.toISOString().slice(11, 16)))).toEqual(new Set(["03:00", "06:00", "09:00", "12:00", "15:00"]));
    expect(posts.filter((p) => p.slot === 0).every((p) => p.visualId === posts.find((x) => x.slot === 0 && x.accountId.startsWith("x:"))!.visualId)).toBe(true);
    expect(posts.filter((p) => p.angle === "macro-24h").every((p) => p.visualId === null)).toBe(true);
    // The skills reach the writer, and their hash is stored.
    expect(complete.mock.calls[0][0].system).toMatch(/Content matrix/);
    expect((await db.select().from(sandbox.sandboxPosts)).every((p) => p.skillHash.length === 16)).toBe(true);

    await run(sandboxPosts);
    expect(complete).toHaveBeenCalledTimes(6);
  });

  it("a wrong answer is a failed fetch, retried next run", async () => {
    await run(sandboxAccounts);
    complete.mockResolvedValueOnce({ text: JSON.stringify({ posts: ["one"] }), model: "fake" });
    await run(sandboxPosts);
    expect(await db.select().from(sandbox.sandboxPosts)).toHaveLength(5 * POSTS_PER_DAY);
    await run(sandboxPosts);
    expect(await db.select().from(sandbox.sandboxPosts)).toHaveLength(6 * POSTS_PER_DAY);
  });

  it("skills: each channel x tone file exists; an Article must be an object", async () => {
    for (const p of ["x", "substack"] as const) for (const t of ["urgent", "balanced", "neutral"]) expect((await loadSkills(p, t)).text).toMatch(/angle: competitor/i);
    expect(() => parsePosts('{"posts": ["a", "b"]}', [{ article: false }, { article: true }])).toThrow(/not an article/);
  });
});
