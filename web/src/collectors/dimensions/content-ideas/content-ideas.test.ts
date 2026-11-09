import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetches } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { PROPOSED_FORMATS } from "../content-drafts/format";
import { contentIdeas } from ".";
import { ideasSystem, parseIdeas, parseScores, scoresSystem } from "./prompt";

const IDEAS = JSON.stringify({
  ideas: [
    { symbol: "CCLD", title: "CareCloud replaced the client the market thinks it lost.", angle: "Reuters reports a new hospital client.", sources: ["evidence:CCLD|news:n1", "driver:CCLD:1"] },
    { symbol: "CCLD", title: "CareCloud trades a third below its fair value.", angle: "4 USD vs 6.", sources: ["fair-value:CCLD"] },
    { symbol: null, title: "Small caps with a new client beat the story.", angle: "One example this week.", sources: ["signal:CCLD", "not-offered:1"] },
    { symbol: "NOPE", title: "Unknown ticker.", angle: "Dropped.", sources: ["signal:CCLD"] },
    { symbol: "CCLD", title: "No source.", angle: "Dropped.", sources: ["made-up"] },
  ],
});

function grid(ideas: number, skip?: string) {
  const scores = [];
  for (let i = 1; i <= ideas; i++) for (const f of PROPOSED_FORMATS) if (`${i}/${f}` !== skip) scores.push({ idea: i, format: f, score: f === "x-post" ? 90 - i : 50 - i, why: `fit ${i} ${f}` });
  return JSON.stringify({ scores });
}

/** Fake Claude: the proposal call gets IDEAS, the scoring call a full grid (or one missing a pair). */
function fakeComplete(opts: { ideas?: string; scores?: string } = {}) {
  return vi.fn<Complete>(async ({ system }) => {
    if (system.includes("Propose")) return { text: opts.ideas ?? IDEAS, model: "fake" };
    return { text: opts.scores ?? grid(3), model: "fake" };
  });
}

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
});
afterEach(async () => close());

const ctx = (complete: Complete) => ({ env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch, complete });

describe("content-ideas dimension", () => {
  it("proposes the day's Ideas once, scores each on every channel x format, and serves them best first", async () => {
    const complete = fakeComplete();
    const report = await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(complete) });
    expect(report.status).toBe("succeeded");
    expect(complete).toHaveBeenCalledTimes(2);

    const ideas = await db.select().from(content.contentIdeas);
    // 5 proposed: an unknown ticker and one with no offered source are dropped; an unknown source id is dropped, its idea kept.
    expect(ideas.map((i) => i.title)).toHaveLength(3);
    const first = ideas.find((i) => i.rank === 1)!;
    expect(first.sourceRefs.map((s) => s.ref)).toEqual(["evidence:CCLD|news:n1", "driver:CCLD:1"]);
    expect(first.sourceRefs[0]).toMatchObject({ kind: "evidence", symbol: "CCLD", label: "CCLD signs a new hospital client" });
    expect(await db.select().from(content.contentIdeaScores)).toHaveLength(3 * PROPOSED_FORMATS.length);

    const [g] = await db.select().from(content.goldContentIdeas).where(eq(content.goldContentIdeas.id, first.id));
    expect(g).toMatchObject({ companyName: "CareCloud", bestFormat: "x-post", bestScore: 89, draftCount: 0, requests: [] });
    expect(g.scores.map((s) => s.score)).toEqual([...g.scores.map((s) => s.score)].sort((a, b) => b - a));

    // The prompt carried the analysis objects with their ids.
    const prompt = complete.mock.calls[0][0].prompt;
    expect(prompt).toContain("[evidence:CCLD|news:n1]");
    expect(prompt).toContain("[change:");

    // Same day: nothing asked again.
    const again = fakeComplete();
    await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(again) });
    expect(again).not.toHaveBeenCalled();
    expect(await db.select().from(content.contentIdeas)).toHaveLength(3);
  });

  it("reads the publication history so it does not repeat a recent post", async () => {
    // His own Substack post (silver, from the feed); a reference publication's post is not ours.
    await db.insert(content.contentPublications).values([
      { host: "analysisparalysis888.substack.com", name: "Analysis Paralysis", kind: "own", sources: ["rss"], bronzeIds: [] },
      { host: "www.citriniresearch.com", name: "Citrini", kind: "reference", sources: ["rss"], bronzeIds: [] },
    ]);
    const post = { format: "substack-article" as const, topics: [], tickers: ["CCLD"], tickersBySource: {}, sources: ["rss"], bronzeIds: [], publishedAt: new Date(Date.now() - 2 * 86400_000) };
    await db.insert(content.contentPosts).values([
      { ...post, urlKey: "a", url: "https://analysisparalysis888.substack.com/p/a", publicationHost: "analysisparalysis888.substack.com", title: "CareCloud: the client nobody counted" },
      { ...post, urlKey: "b", url: "https://www.citriniresearch.com/p/b", publicationHost: "www.citriniresearch.com", title: "Citrini on AI" },
    ]);
    const complete = fakeComplete();
    await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(complete) });
    const [ideasCall, scoresCall] = complete.mock.calls.map((c) => c[0].prompt);
    expect(ideasCall).toContain("Substack article [CCLD]: CareCloud: the client nobody counted");
    expect(ideasCall).not.toContain("Citrini on AI");
    expect(scoresCall).toContain("substack-article: 20");
    expect(await db.select().from(content.goldContentPublished)).toHaveLength(1);
  });

  it("an incomplete score grid fails the fetch; the next run asks for the scores only", async () => {
    await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(fakeComplete({ scores: grid(3, "2/linkedin-post") })) });
    const failed = await db.select().from(fetches).where(eq(fetches.dimension, "content-ideas"));
    expect(failed.find((f) => f.subject.startsWith("scores:"))?.error).toMatch(/no score for 2\/linkedin-post/);
    expect(await db.select().from(content.contentIdeaScores)).toHaveLength(0);
    expect((await db.select().from(content.goldContentIdeas))[0].bestFormat).toBeNull();

    const retry = fakeComplete();
    await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(retry) });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].system).not.toContain("Propose");
    expect(await db.select().from(content.contentIdeaScores)).toHaveLength(3 * PROPOSED_FORMATS.length);
  });

  it("too few usable Ideas fail the fetch, never land in silver", async () => {
    const bad = JSON.stringify({ ideas: [{ symbol: "CCLD", title: "Only one.", angle: "x", sources: ["signal:CCLD"] }] });
    const report = await runDimension(db, contentIdeas, { trigger: "test", ctx: ctx(fakeComplete({ ideas: bad })) });
    expect(report.sources[0].errors[0].message).toMatch(/only 1 usable ideas/);
    expect(await db.select().from(content.contentIdeas)).toHaveLength(0);
  });
});

describe("idea parsers", () => {
  it("keeps only offered sources and known tickers", () => {
    const offered = [{ ref: "signal:A", kind: "signal" as const, symbol: "A", label: "A: BUY", detail: "" }];
    const ok = { symbol: "A", title: "T — dash", angle: "x", sources: ["signal:A"] };
    expect(parseIdeas(JSON.stringify({ ideas: [ok, ok, ok] }), offered, ["A"])[0].title).toBe("T, dash");
    expect(() => parseIdeas(JSON.stringify({ ideas: [ok, { ...ok, sources: ["x"] }] }), offered, ["A"])).toThrow(/only 1/);
  });
  it("needs every idea x format scored, 0-100", () => {
    expect(parseScores(grid(1), 1)).toHaveLength(PROPOSED_FORMATS.length);
    expect(() => parseScores(JSON.stringify({ scores: [{ idea: 1, format: "x-post", score: 140, why: "" }] }), 1)).toThrow(/no score for .*1\/x-post/);
  });
  it("no longer proposes articles (Thierry writes them) and allows a plain company update", () => {
    expect(PROPOSED_FORMATS).not.toContain("substack-article");
    expect(scoresSystem()).not.toContain("substack-article");
    const withArticle = JSON.parse(grid(1)) as { scores: unknown[] };
    withArticle.scores.push({ idea: 1, format: "substack-article", score: 99, why: "deep" });
    expect(parseScores(JSON.stringify(withArticle), 1).map((s) => s.format)).not.toContain("substack-article");
    expect(ideasSystem()).toMatch(/update on the company/);
  });
});
