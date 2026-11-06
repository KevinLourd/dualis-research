import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { addSamples } from "@/content/manual";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentAccounts, normalizeHost } from "../content-accounts";
import { contentVoices } from ".";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const site = (async () => new Response("<html><script>x()</script><body><h1>Duality</h1><p>We manage a global long/short equity portfolio and focus on smaller companies.</p></body></html>")) as unknown as typeof fetch;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, contentAccounts, { trigger: "test", ctx: { env: { REPO_ROOT }, fetch: site } });
  // Two posts of Thierry's Substack and one admired post, as content-posts stores them.
  await db.insert(content.contentPublications).values([
    { host: "analysisparalysis888.substack.com", name: "Analysis Paralysis", kind: "own", sources: ["substack-rss"], bronzeIds: [] },
    { host: "read.aurelionresearch.com", name: "Aurelion", kind: "reference", sources: ["substack-rss"], bronzeIds: [] },
  ]);
  const post = (host: string, slug: string, excerpt: string) => ({
    urlKey: `${host}/p/${slug}`, url: `https://${host}/p/${slug}`, publicationHost: host, format: "substack-article" as const, title: slug,
    publishedAt: new Date(), topics: [], tickers: [], tickersBySource: {}, excerpt, sources: ["substack-rss"], bronzeIds: [],
  });
  await db.insert(content.contentPosts).values([
    post("analysisparalysis888.substack.com", "a", "THIERRY-TEXT-A short sentences, numbers first."),
    post("analysisparalysis888.substack.com", "b", "THIERRY-TEXT-B the fundamental inflection."),
    post("read.aurelionresearch.com", "c", "AURELION-TEXT what if we're wrong."),
  ]);
});
afterEach(async () => close());

const writer = () => vi.fn<Complete>(async ({ prompt }) => ({ text: `Guide — learned from: ${prompt.includes("THIERRY-TEXT") ? "substack" : prompt.includes("Duality") ? "website" : "?"}`, model: "fake" }));
const ctx = (complete: Complete) => ({ env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch: site, complete });

describe("content-accounts + content-voices", () => {
  it("accounts file lands in bronze/silver/gold; the fund's website text is kept for its voice", async () => {
    const accounts = await db.select().from(content.goldContentAccounts);
    expect(accounts.map((a) => a.id).sort()).toEqual(["linkedin:duality-asset-management", "linkedin:thierrymatin", "substack:analysisparalysis888", "x:quantum_macro"]);
    const [fund] = await db.select().from(content.contentAccounts).where(eqId("linkedin:duality-asset-management"));
    expect(fund.websiteText).toContain("global long/short");
    expect(fund.websiteText).not.toContain("x()");
    expect(fund.sources.sort()).toEqual(["repo", "website"]);
    expect(normalizeHost("https://www.X.com/")).toBe("www.x.com");
  });

  it("learns each voice once from what it has: own posts, else the same person's Substack, else the website", async () => {
    const complete = writer();
    await runDimension(db, contentVoices, { trigger: "test", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(4);
    const prompts = complete.mock.calls.map(([r]) => r.prompt);
    expect(prompts.every((p) => p.includes("AURELION-TEXT"))).toBe(true);
    const gold = await db.select().from(content.goldContentAccounts);
    const by = (id: string) => gold.find((a) => a.id === id)!;
    expect(by("substack:analysisparalysis888").voiceBasis).toMatch(/2 of its own posts/);
    expect(by("linkedin:thierrymatin").voiceBasis).toMatch(/his Substack posts/);
    expect(by("linkedin:duality-asset-management").voiceBasis).toMatch(/its website/);
    expect(by("linkedin:thierrymatin").voiceGuide).not.toMatch(/[—–]/);

    // Same inputs: nothing asked again. New pasted posts: a new guide for that account only.
    await runDimension(db, contentVoices, { trigger: "test", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(4);
    await addSamples(db, "linkedin:thierrymatin", "A LinkedIn post of Thierry about Monro and Icahn, numbers first.\n---\nAnother one about Boot Barn stores and returns.", "user_1");
    await runDimension(db, contentVoices, { trigger: "test", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(5);
    expect((await db.select().from(content.contentVoices)).filter((v) => v.accountId === "linkedin:thierrymatin")).toHaveLength(2);
    // A re-read of the accounts file keeps the pasted posts (both sources tagged).
    await runDimension(db, contentAccounts, { trigger: "test", ctx: { env: { REPO_ROOT }, fetch: site } });
    const [thierry] = await db.select().from(content.contentAccounts).where(eqId("linkedin:thierrymatin"));
    expect(thierry.samples).toHaveLength(2);
    expect(thierry.sources.sort()).toEqual(["console", "repo"]);
  });
});

import { eq } from "drizzle-orm";
const eqId = (id: string) => eq(content.contentAccounts.id, id);
