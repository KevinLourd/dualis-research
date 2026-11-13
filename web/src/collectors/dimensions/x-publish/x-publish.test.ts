import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { goldSandboxPosts, sandboxVisuals } from "@/db/schema/sandbox";
import { goldXPublications, xConnections, xPublications } from "@/db/schema/x";
import type { Db } from "@/db/types";
import { open } from "@/onedrive/auth";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { MAX_ATTEMPTS, postText, xPublish } from ".";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

const KEY = Buffer.alloc(32, 7).toString("base64");
const env = { X_CLIENT_ID: "cid", X_CLIENT_SECRET: "csecret", X_TOKEN_KEY: KEY, X_REFRESH_TOKEN_SIRENSMALLCAPS: "r0" };
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const SIREN = "x:sirensmallcaps";

type Call = { url: string; init: RequestInit };

/** A fake X: rotates the refresh token on each refresh, uploads, posts. `tweetStatus` lets a test make X refuse. */
function fakeX(opts: { tweetStatus?: number } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/2/oauth2/token")) {
      n += 1;
      return new Response(JSON.stringify({ access_token: `a${n}`, refresh_token: `r${n}` }), { status: 200 });
    }
    if (url.endsWith("/2/media/upload")) return new Response(JSON.stringify({ data: { id: `m${n}` } }), { status: 200 });
    if (url.endsWith("/2/tweets")) {
      const status = opts.tweetStatus ?? 201;
      return new Response(JSON.stringify(status === 201 ? { data: { id: `t${n}` } } : { title: "Forbidden" }), { status });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

async function picture(): Promise<string> {
  const [v] = await db
    .insert(sandboxVisuals)
    .values({ key: `post:${crypto.randomUUID()}`, kind: "x-chart", status: "ok", mime: "image/png", file: Buffer.from([137, 80, 78, 71]), sources: ["test"], bronzeIds: [] })
    .returning({ id: sandboxVisuals.id });
  return v.id;
}

async function post(accountId: string, slot: number, minutes: number, extra: Partial<typeof goldSandboxPosts.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(goldSandboxPosts).values({
    id,
    accountId,
    day,
    slot,
    format: "x-post",
    angle: "signal",
    text: `Post ${slot}\n\nNot investment advice.`,
    input: { kind: "signal", label: "x", url: null },
    visualId: await picture(),
    postAt: new Date(now + minutes * 60_000),
    ...extra,
  });
  return id;
}

const run = (fetchFn: typeof fetch) => runDimension(db, xPublish, { trigger: "test", ctx: { env, fetch: fetchFn } });
const tweets = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/2/tweets")).map((c) => JSON.parse(String(c.init.body)) as { text: string; media: { media_ids: string[] } });

describe("x-publish", () => {
  it("posts the oldest due post of a connected account, text + picture, and saves the rotated token", async () => {
    await post(SIREN, 0, -120);
    await post(SIREN, 1, -60);
    await post(SIREN, 2, 120);
    await post("x:narrativegap", 0, -120);
    const x = fakeX();
    await run(x.fetchFn);
    expect(tweets(x.calls)).toEqual([{ text: "Post 0\n\nNot investment advice.", media: { media_ids: ["m1"] } }]);
    const [conn] = await db.select().from(xConnections);
    expect(conn.handle).toBe("sirensmallcaps");
    expect(await open(KEY, conn.refreshToken)).toBe("r1");
    const [gold] = await db.select().from(goldXPublications);
    expect(gold).toMatchObject({ accountId: SIREN, slot: 0, status: "posted", url: "https://x.com/sirensmallcaps/status/t1" });
    // Bronze never holds a token.
    const bronze = await db.select().from(fetches);
    expect(JSON.stringify(bronze)).not.toMatch(/\b(a1|r0|r1|csecret)\b/);
  });

  it("next run posts the next slot with the rotated token, never a slot already live, never a future one", async () => {
    await post(SIREN, 0, -120);
    await post(SIREN, 1, -60);
    await post(SIREN, 2, 120);
    const x = fakeX();
    await run(x.fetchFn);
    await run(x.fetchFn);
    // A review round writes slot 0 again under a new id: still live, never posted twice.
    await post(SIREN, 0, -120, { text: "Post 0 rewritten" });
    await run(x.fetchFn);
    expect(tweets(x.calls).map((t) => t.text)).toEqual(["Post 0\n\nNot investment advice.", "Post 1\n\nNot investment advice."]);
    const refreshes = x.calls.filter((c) => c.url.endsWith("/oauth2/token")).map((c) => new URLSearchParams(String(c.init.body)).get("refresh_token"));
    expect(refreshes).toEqual(["r0", "r1"]);
  });

  it(`a refused post is retried, then given up after ${MAX_ATTEMPTS} attempts`, async () => {
    await post(SIREN, 0, -60);
    const x = fakeX({ tweetStatus: 403 });
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await run(x.fetchFn);
    expect(tweets(x.calls)).toHaveLength(MAX_ATTEMPTS);
    const [row] = await db.select().from(xPublications);
    expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(row.error).toMatch(/403/);
  });

  it("an X Article goes out as its title and subtitle", () => {
    expect(postText({ format: "x-article", title: "BREAKING: Profit x4", subtitle: "Wall Street missed it", text: "## Body" })).toBe("BREAKING: Profit x4\n\nWall Street missed it\n\nNot investment advice.");
  });

  it("no connected account = nothing to do", async () => {
    await post(SIREN, 0, -60);
    const x = fakeX();
    await runDimension(db, xPublish, { trigger: "test", ctx: { env: { ...env, X_REFRESH_TOKEN_SIRENSMALLCAPS: undefined }, fetch: x.fetchFn } });
    expect(x.calls).toHaveLength(0);
  });
});
