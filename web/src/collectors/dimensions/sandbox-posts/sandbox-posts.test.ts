import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { SANDBOX_ACCOUNTS, sandboxAccounts } from "../sandbox-accounts";
import { parsePosts, POSTS_PER_DAY, sandboxPosts, sandboxSystem } from ".";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

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

/** Fake Claude: one JSON answer of N posts, numbered so the test can tell them apart. */
const complete = vi.fn<Complete>(async ({ system, prompt }) => {
  const n = (prompt.match(/^## Idea \d+/gm) ?? []).length;
  const tone = /BREAKING/.test(system) ? "urgent" : /sober/.test(system) ? "neutral" : "balanced";
  return { text: JSON.stringify({ posts: Array.from({ length: n }, (_, i) => `${tone} post ${i + 1} — on $CCLD`) }), model: "fake" };
});
const ctx = { env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch, complete };
const run = (d: Parameters<typeof runDimension>[1]) => runDimension(db, d, { trigger: "test", ctx });

beforeEach(async () => {
  ({ db, close } = await testDb());
  complete.mockClear();
  ideaIds.length = 0;
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  // 6 Ideas: the lowest score is left out of the day's 5.
  for (const [rank, score] of [[1, 90], [2, 40], [3, 80], [4, 70], [5, 60], [6, 50]] as const) ideaIds.push(await addIdea(rank, score));
  await db.insert(content.contentVisuals).values({ ideaId: ideaIds[0], kind: "x-chart", version: "v", status: "ok", mime: "image/png", file: PNG, sizeBytes: PNG.length, sources: ["render"], bronzeIds: [] });
  await db.insert(content.goldContentVisuals).values({ id: (await db.select().from(content.contentVisuals))[0].id, ideaId: ideaIds[0], kind: "x-chart", status: "ok", mime: "image/png", createdAt: new Date() });
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
    expect((await db.select().from(sandbox.sandboxAccounts)).every((a) => a.sources.includes("seed") && a.bronzeIds.length === 1)).toBe(true);
    expect(SANDBOX_ACCOUNTS.some((a) => /thierry|quantum_macro/i.test(`${a.handle} ${a.author} ${a.bio}`))).toBe(false);
  });
});

describe("sandbox-posts", () => {
  it("writes the day's top 5 Ideas once per account (one call each), with the Idea's chart; a rerun does nothing", async () => {
    await run(sandboxAccounts);
    const report = await run(sandboxPosts);
    expect(report.status).toBe("succeeded");
    expect(complete).toHaveBeenCalledTimes(6);
    const posts = await db.select().from(sandbox.goldSandboxPosts);
    expect(posts).toHaveLength(6 * POSTS_PER_DAY);
    // Top 5 by score: 90, 80, 70, 60, 50 (the 40 is left out), slot 0 = the best.
    const bySlot = [...new Set(posts.filter((p) => p.slot === 0).map((p) => p.ideaId))];
    expect(bySlot).toEqual([ideaIds[0]]);
    expect(posts.some((p) => p.ideaId === ideaIds[1])).toBe(false);
    // Dashes stripped, disclaimer added, staggered display times.
    expect(posts.every((p) => !p.text.includes("—") && p.text.endsWith("Not investment advice."))).toBe(true);
    expect(new Set(posts.map((p) => p.postAt.toISOString().slice(11, 16)))).toEqual(new Set(["03:00", "06:00", "09:00", "12:00", "15:00"]));
    // X accounts get the Idea's X chart; Substacks have none (no Note chart drawn).
    const accounts = await db.select().from(sandbox.goldSandboxAccounts);
    const platform = new Map(accounts.map((a) => [a.id, a.platform]));
    const first = posts.filter((p) => p.ideaId === ideaIds[0]);
    expect(first.filter((p) => p.visualId).map((p) => platform.get(p.accountId))).toEqual(["x", "x", "x"]);
    // Tone reaches the writer.
    expect(posts.find((p) => p.accountId === "x:sirensmallcaps")?.text).toMatch(/^urgent/);
    expect(posts.find((p) => p.accountId === "substack:ledgerlens")?.text).toMatch(/^neutral/);

    await run(sandboxPosts);
    expect(complete).toHaveBeenCalledTimes(6);
    expect(await db.select().from(sandbox.sandboxPosts)).toHaveLength(6 * POSTS_PER_DAY);
  });

  it("a wrong count of posts is a failed fetch, retried next run", async () => {
    await run(sandboxAccounts);
    complete.mockResolvedValueOnce({ text: JSON.stringify({ posts: ["one"] }), model: "fake" });
    await run(sandboxPosts);
    const posts = await db.select().from(sandbox.sandboxPosts);
    expect(posts).toHaveLength(5 * POSTS_PER_DAY);
    await run(sandboxPosts);
    expect(await db.select().from(sandbox.sandboxPosts)).toHaveLength(6 * POSTS_PER_DAY);
  });

  it("tones are distinct prompts; balanced is the house prompt", () => {
    expect(sandboxSystem("urgent", "x", "A", 5)).toContain("BREAKING");
    expect(sandboxSystem("neutral", "substack", "A", 5)).toContain("No emoji");
    expect(sandboxSystem("balanced", "x", "A", 5)).toContain("Tone: alarm");
    expect(sandboxSystem("balanced", "x", "A", 5)).not.toMatch(/Thierry|Answer with the post text/);
    expect(() => parsePosts('{"posts": ["a", ""]}', 2)).toThrow();
  });
});
