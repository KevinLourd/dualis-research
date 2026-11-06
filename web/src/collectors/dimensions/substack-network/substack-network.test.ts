import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import * as growth from "@/db/schema/growth";
import { runSources } from "@/db/schema/ops";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { promoteOutreach } from "../growth-outreach";
import { FIT_QUESTION_KEY, makeSubstackNetwork } from ".";
import { GATEWAYS, OWN, SEEDS } from "./seeds";

/**
 * A tiny Substack: two seeds (A, B) both recommend X (a small-cap writer); A also recommends Y (a cooking blog),
 * X recommends Z (a value writer), Y recommends Z. Z is then recommended by 2 crawled publications.
 */
const SEED_A = SEEDS[0];
const SEED_B = SEEDS[1];
const pub = (id: number, name: string, hero: string, handle: string) => ({
  id,
  name,
  subdomain: name.toLowerCase().replace(/\W+/g, ""),
  custom_domain: null,
  hero_text: hero,
  payments_state: "enabled",
  author: { handle, name: `${name} author` },
});
const X = pub(300, "Microcap Hunter", "Small-cap special situations", "xhandle");
const Y = pub(400, "Weekly Recipes", "Cooking", "yhandle");
const Z = pub(500, "Value Notes", "Deep value investing in Japan", "zhandle");
const RECS: Record<string, unknown[]> = {
  [SEED_A.id]: [X, Y],
  [SEED_B.id]: [X],
  "300": [Z, X],
  "400": [Z],
  "500": [],
};

const POSTS: Record<string, { publication_id: number; title: string; post_date: string; audience: string }[]> = {
  "301": [{ publication_id: 300, title: "Why ABC is cheap", post_date: "2026-11-03T10:00:00Z", audience: "only_paid" }],
  "501": [{ publication_id: 500, title: "Old post", post_date: "2026-07-01T10:00:00Z", audience: "everyone" }],
};

/** Substack as GitHub Actions sees it: substack.com challenged, publications' own domains answer the whole API. */
function fakeFetch(opts: { rateLimit?: string[]; challengeFirstGateway?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (!GATEWAYS.includes(url.hostname)) return new Response("<title>Just a moment...</title>", { status: 403 });
    if (opts.challengeFirstGateway && url.hostname === GATEWAYS[0]) return new Response("<title>Just a moment...</title>", { status: 403 });
    if (url.pathname === "/api/v1/profile/posts") return Response.json({ posts: POSTS[url.searchParams.get("profile_user_id") ?? ""] ?? [] });
    const recs = url.pathname.match(/^\/api\/v1\/recommendations\/from\/(\d+)$/);
    if (recs) {
      if (opts.rateLimit?.includes(recs[1])) return new Response("Too Many Requests", { status: 429 });
      return Response.json((RECS[recs[1]] ?? []).map((p) => ({ recommendedPublication: p })));
    }
    const profile = url.pathname.match(/^\/api\/v1\/user\/([^/]+)\/public_profile$/);
    if (profile) {
      const handle = profile[1];
      if (handle === OWN.handle) {
        return Response.json({ handle, name: "Analysis Paralysis", id: 1, subscriberCountNumber: 151, publicationUsers: [{ publication: { id: Number(OWN.publicationId), name: "Analysis Paralysis", subdomain: OWN.handle, author_id: 1 } }] });
      }
      const p = [X, Y, Z].find((x) => x.author.handle === handle);
      if (!p) return new Response("not found", { status: 404 });
      return Response.json({ handle, name: p.author.name, id: p.id + 1, subscriberCountNumber: p.id * 10, publicationUsers: [{ publication: { ...p, author_id: p.id + 1 } }] });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return { f, calls };
}

const fakeComplete: Complete = async ({ prompt }) => ({
  text: JSON.stringify({ verdict: prompt.includes("Microcap Hunter") ? "yes" : "partly", probability: 0.8, cited_sentence: null }),
  model: "fake",
});

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

const NOW = new Date("2026-11-04T12:00:00Z");
const run = (fetchImpl: typeof fetch) =>
  runDimension(db, makeSubstackNetwork({ complete: fakeComplete, now: () => NOW }), { trigger: "test", ctx: { env: {}, fetch: fetchImpl } });

describe("substack-network dimension", () => {
  it("crawls 2 hops into bronze, one publication reached from two seeds = one row carrying both", async () => {
    const { f } = fakeFetch();
    const report = await run(f);
    expect(report.error).toBeNull();

    const bronze = await db.select().from(fetches);
    const subjects = bronze.map((b) => b.subject);
    expect(subjects).toContain(`recs:${SEED_A.id}`); // hop 1
    expect(subjects).toContain("recs:300"); // hop 2
    expect(subjects).toContain("posts:301"); // X's author
    expect(subjects).toContain(`profile:${OWN.handle}`);

    const pubs = await db.select().from(growth.substackPublications);
    const x = pubs.filter((p) => p.id === "300");
    expect(x).toHaveLength(1);
    expect(x[0].reachedFrom.sort()).toEqual([SEED_A.host, SEED_B.host].sort());
    expect(x[0].sources.sort()).toEqual(["substack-profile", "substack-recommendations"]);
    // Every call went through a publication's own domain, never substack.com.
    expect(bronze.every((b) => GATEWAYS.includes(new URL(String(b.request.url)).hostname))).toBe(true);
    expect(x[0].authorHandle).toBe("xhandle");

    const edges = await db.select().from(growth.substackRecommendations);
    expect(edges.filter((e) => e.toId === "500").map((e) => e.fromId).sort()).toEqual(["300", "400"]);
  });

  it("ranks niche candidates in gold, flags the inactive one, judges fit once, records Thierry's count", async () => {
    const { f } = fakeFetch();
    await run(f);
    const targets = await db.select().from(growth.goldGrowthTargets);
    // X recommended by A and B (inbound 2) and Z by X and Y (inbound 2); Y (cooking) is not niche.
    expect(targets.map((t) => t.publicationId).sort()).toEqual(["300", "500"]);
    const z = targets.find((t) => t.publicationId === "500")!;
    expect(z.inactive).toBe(true); // last post 2026-07-01
    expect(z.subscribers).toBe(5000);
    expect(targets.find((t) => t.publicationId === "300")!.rank).toBe(1);
    expect(targets.find((t) => t.publicationId === "300")!.fit).toBe("yes");

    // The public count (no dashboard reading in this test), dated on the day it was fetched.
    const fetchedOn = (await db.select().from(fetches))[0].fetchedAt.toISOString().slice(0, 10);
    expect(await db.select().from(growth.goldGrowthAudience)).toEqual([expect.objectContaining({ date: fetchedOn, subscribers: 151, sources: ["substack-profile"] })]);

    await run(fakeFetch().f);
    const fits = (await db.select().from(judgments)).filter((j) => j.questionKey === FIT_QUESTION_KEY);
    expect(fits).toHaveLength(2); // never re-judged
  });

  it("a challenged gateway moves on to the next one, the run stays clean", async () => {
    const report = await run(fakeFetch({ challengeFirstGateway: true }).f);
    expect(report.status).toBe("succeeded");
    expect((await db.select().from(growth.goldGrowthTargets)).map((t) => t.publicationId).sort()).toEqual(["300", "500"]);
  });

  it("a 429 lands in bronze as a failed fetch, the run goes on as partial", async () => {
    const { f } = fakeFetch({ rateLimit: ["300"] });
    const report = await run(f);
    expect(report.status).toBe("partial");
    const failed = (await db.select().from(fetches)).filter((b) => b.error);
    expect(failed.map((b) => [b.subject, b.httpStatus])).toEqual([["recs:300", 429]]);
    const [src] = await db.select().from(runSources);
    expect(src.failed).toBe(1);
    expect(src.errors[0].message).toContain("HTTP 429");
    // Z is now recommended by Y only: below the bar.
    expect((await db.select().from(growth.goldGrowthTargets)).map((t) => t.publicationId)).toEqual(["300"]);
  });

  it("a drafted author joins the candidates even below the inbound bar", async () => {
    await promoteOutreach(db, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000002",
        dimension: "growth-outreach",
        source: "claude-draft",
        subject: "data/outreach/x.md",
        request: {},
        httpStatus: null,
        payload: null,
        payloadText: "## 1. Weekly Recipes (@yhandle) — 4K\n- Hook: h\n- Ask: a\n\n> Hi,\n>\n> Hello.\n",
        error: null,
        fetchedAt: NOW,
      },
    ]);
    await run(fakeFetch().f);
    expect((await db.select().from(growth.goldGrowthTargets)).map((t) => t.publicationId).sort()).toEqual(["300", "400", "500"]);
  });
});
