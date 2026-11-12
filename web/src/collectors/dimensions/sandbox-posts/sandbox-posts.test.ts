import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exhibits, fairValues, narrativeStates } from "@/db/schema/analysis";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import * as sandbox from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { macroNews, MACRO_QUERIES } from "../macro-news";
import { SANDBOX_ACCOUNTS, sandboxAccounts } from "../sandbox-accounts";
import { substackTrending, TRENDING_HOSTS } from "../substack-trending";
import { opportunityStory } from "../content-visuals/opportunity";
import { sandboxImageFix } from "../sandbox-image-fix";
import { sandboxReview } from "../sandbox-review";
import { postKey, sandboxVisuals } from "../sandbox-visuals";
import { articleAngle, loadSkills, parsePosts, POSTS_PER_DAY, sandboxPostSubjects, sandboxPosts } from ".";

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

/** The review the fake reviewer gives: the account whose prompt line starts « <fail> fails its first round with this edit. */
const reviewPlan: { fail: string | null; edit: { skill: string; old: string; new: string } | null } = { fail: null, edit: null };
/** The fake picture corrector: `fixFirst` = on its first pass it corrects post 1 of the account whose prompt names it. */
const fixPlan: { fixFirst: string | null } = { fixFirst: null };

/** Fake Claude: one JSON item per « ## Post » (an object for the Article), each with its picture; the reviewer passes or fails. */
const complete = vi.fn<Complete>(async ({ system, prompt }) => {
  // The judge of which earlier period a reality line compares to: the period before the latest.
  if (system.startsWith("You judge")) {
    const ids = [...prompt.matchAll(/^(\d{4}-\d{2}-\d{2}) \(/gm)].map((m) => m[1]);
    return { text: JSON.stringify({ verdict: ids.at(-2) ?? "none", probability: 0.9, cited_sentence: null, reason: "r" }), model: "fake" };
  }
  if (system.startsWith("You correct the pictures")) {
    const blocks = prompt.split(/^(?=## Post \d+:)/m).filter((b) => b.startsWith("## Post"));
    const fix = !!fixPlan.fixFirst && prompt.includes(`« ${fixPlan.fixFirst}`) && /correction pass 1 of/.test(prompt);
    const posts = blocks.map((b, i) => {
      if (!(fix && i === 0)) return { post: i + 1, ok: true, defects: [] };
      const spec = JSON.parse(/^Its picture's spec now: (.*)$/m.exec(b)![1]);
      return { post: i + 1, ok: false, defects: ["The label is cut."], image: { ...spec, chartLabel: "Share price, $, last 12 months" } };
    });
    return { text: JSON.stringify({ posts }), model: "fake" };
  }
  if (system.startsWith("You review the Sandbox")) {
    const n = [...prompt.matchAll(/^## Post \d+:/gm)].length;
    const fail = !!reviewPlan.fail && prompt.includes(`« ${reviewPlan.fail}`) && /round 1 of/.test(prompt);
    const posts = Array.from({ length: n }, (_, i) => ({ post: i + 1, imageAlone: !(fail && i === 0), aligned: true, clear: true, why: fail && i === 0 ? "The picture shows the price, the text is about profit." : "Reads at once." }));
    return { text: JSON.stringify({ posts, edits: fail && reviewPlan.edit ? [{ ...reviewPlan.edit, why: "picture off-topic" }] : [] }), model: "fake" };
  }
  const blocks = prompt.split(/^(?=## Post \d+:)/m).filter((b) => b.startsWith("## Post"));
  const tone = /in the URGENT tone/.test(system) ? "urgent" : /in the NEUTRAL tone/.test(system) ? "neutral" : "balanced";
  // The picture: the first chart listed for that post, arrow on its first point.
  const image = (block: string) => {
    const charts = block.split("can draw (id: what it shows; then the points its arrow can hit, id: value):\n")[1];
    const [, chart] = /^- (\S+): /m.exec(charts)!;
    const [, point] = /^ {2}- (\S+): /m.exec(charts)!;
    return { chart, point, style: tone === "urgent" ? "breaking" : "pro", title: `${tone} claim`, chartLabel: "Share price, 12 months", note: "Down 30% — in a year", priceSays: "Debt is fine", newsLine: null, news: null };
  };
  const posts = blocks.map((block, i) => {
    const [, format, angle] = /^## Post \d+: ([^,]+), angle (\S+)/.exec(block)!;
    return /Article/.test(format) ? { post: i + 1, title: `${tone} article ${angle}`, subtitle: "Sub", body: "## What happened\n\nCareCloud — profit up.\n\n- one\n- two", image: image(block), ...(angle === "macro-24h" ? { ticker: "$ccld" } : {}) } : { post: i + 1, text: `${tone} ${angle} post ${i + 1} — $CCLD`, image: image(block), ...(angle === "macro-24h" ? { ticker: "$ccld" } : {}) };
  });
  // Real writers sometimes answer twice ("Correction: ...") and out of order: the last object, matched on post numbers, wins.
  return { text: `${JSON.stringify({ posts: ["placeholder"] })}\n\nCorrection, the full answer:\n\n${JSON.stringify({ posts: posts.reverse() })}`, model: "fake" };
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

let skillsDir: string;
beforeEach(async () => {
  ({ db, close } = await testDb());
  complete.mockClear();
  reviewPlan.fail = null;
  reviewPlan.edit = null;
  fixPlan.fixFirst = null;
  // The reviewer edits skill files: tests work on a copy.
  skillsDir = await mkdtemp(join(tmpdir(), "dualis-skills-"));
  await cp(new URL("../../../../../.claude/skills/", import.meta.url), skillsDir, { recursive: true });
  process.env.SANDBOX_SKILLS_DIR = skillsDir;
  ideaIds.length = 0;
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  const days = Array.from({ length: 60 }, (_, i) => new Date(Date.now() - (60 - i) * 86400_000).toISOString().slice(0, 10));
  await db.insert(gold.priceBars).values(days.map((date, i) => ({ symbol: "CCLD", date, close: 3 - i / 60, sources: ["yahoo"], alternatives: [] })));
  for (const [rank, score] of [[1, 90], [2, 40], [3, 80], [4, 70], [5, 60], [6, 50]] as const) ideaIds.push(await addIdea(rank, score));
  // A reference publication's recent post (content-posts) for the competitor angle.
  await db.insert(content.contentPublications).values({ host: "www.citriniresearch.com", name: "Citrini Research", kind: "reference", sources: ["rss"], bronzeIds: [] });
  await db.insert(content.contentPosts).values({ urlKey: "citrini/p/x", url: "https://www.citriniresearch.com/p/x", publicationHost: "www.citriniresearch.com", format: "substack-article", title: "A primer on shipping", excerpt: "Shipping is a cycle.", publishedAt: hoursAgo(72), topics: [], tickers: [], tickersBySource: {}, sources: ["rss"], bronzeIds: [] });
});
afterEach(async () => {
  await close();
  delete process.env.SANDBOX_SKILLS_DIR;
  await rm(skillsDir, { recursive: true, force: true });
});

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
    // Dashes stripped, disclaimer, staggered times; each post carries the picture its writer specified, not drawn yet.
    expect(posts.every((p) => !p.text.includes("—") && /Not investment advice/.test(p.text))).toBe(true);
    expect(new Set(posts.map((p) => p.postAt.toISOString().slice(11, 16)))).toEqual(new Set(["03:00", "06:00", "09:00", "12:00", "15:00"]));
    const silverPosts = await db.select().from(sandbox.sandboxPosts);
    expect(silverPosts.every((p) => p.image && p.round === 1 && p.visualId === null)).toBe(true);
    expect(silverPosts.find((p) => p.angle === "macro-24h")?.image).toMatchObject({ chart: "price", point: "latest" });
    expect(silverPosts.find((p) => p.accountId.startsWith("x:sirensmallcaps"))?.image?.note).toBe("Down 30%, in a year");
    // The writer sees each post's charts and the tone's Image section.
    expect(complete.mock.calls[0][0].prompt).toMatch(/picture can draw/);
    expect(complete.mock.calls[0][0].system).toMatch(/## Image/);
    // The skills reach the writer, and their hash is stored.
    expect(complete.mock.calls[0][0].system).toMatch(/Content matrix/);
    expect((await db.select().from(sandbox.sandboxPosts)).every((p) => p.skillHash.length === 16)).toBe(true);

    await run(sandboxPosts);
    expect(complete).toHaveBeenCalledTimes(6);
  });

  it("every post gets its OWN picture, drawn as its writer specified; X Article covers at 5:2", async () => {
    await run(macroNews);
    await run(substackTrending);
    await run(sandboxAccounts);
    await run(sandboxPosts);
    const report = await run(sandboxVisuals);
    expect(report.error ?? report.sources.flatMap((x) => x.errors)).toEqual([]);
    expect(report.status).toBe("succeeded");
    const posts = await db.select().from(sandbox.goldSandboxPosts);
    expect(posts.filter((p) => p.visualId)).toHaveLength(6 * POSTS_PER_DAY);
    expect(new Set(posts.map((p) => p.visualId)).size).toBe(6 * POSTS_PER_DAY);
    const macro = posts.filter((p) => p.angle === "macro-24h");
    expect(new Set(macro.map((p) => p.symbol))).toEqual(new Set(["CCLD"]));
    const own = await db.select({ id: sandbox.sandboxVisuals.id, kind: sandbox.sandboxVisuals.kind, width: sandbox.sandboxVisuals.width, height: sandbox.sandboxVisuals.height }).from(sandbox.sandboxVisuals);
    const xArticles = posts.filter((p) => p.format === "x-article");
    expect(xArticles.every((p) => own.find((v) => v.id === p.visualId)?.kind === "x-cover")).toBe(true);
    expect(own.filter((v) => v.kind === "x-cover").every((v) => v.width! / v.height! === 2.5)).toBe(true);
    // The tone's style: urgent = the breaking look, balanced and neutral (in this fake) = the pro look.
    const shorts = posts.filter((p) => !p.format.endsWith("article"));
    expect(shorts.filter((p) => /siren/.test(p.accountId)).every((p) => own.find((v) => v.id === p.visualId)?.kind === "chart")).toBe(true);
    expect(shorts.filter((p) => !/siren/.test(p.accountId)).every((p) => own.find((v) => v.id === p.visualId)?.kind === "x-chart")).toBe(true);
    // Nothing left to draw on a rerun.
    await run(sandboxVisuals);
    expect((await db.select().from(sandbox.sandboxVisuals)).length).toBe(own.length);
    // A picture drawn by an older drawing code (its key lacks this version) is drawn again, with no Claude call.
    const calls = complete.mock.calls.length;
    await db.update(sandbox.sandboxVisuals).set({ key: "post:old-drawing" }).where(eq(sandbox.sandboxVisuals.id, posts[0].visualId!));
    await run(sandboxVisuals);
    const [again] = await db.select().from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.id, posts[0].id));
    expect(again.visualId).not.toBe(posts[0].visualId);
    expect(complete.mock.calls.length).toBe(calls);
  }, 60_000);

  it("a wrong answer is a failed fetch, retried next run", async () => {
    await run(sandboxAccounts);
    complete.mockResolvedValueOnce({ text: JSON.stringify({ posts: ["one"] }), model: "fake" });
    await run(sandboxPosts);
    expect(await db.select().from(sandbox.sandboxPosts)).toHaveLength(5 * POSTS_PER_DAY);
    await run(sandboxPosts);
    const posts = await db.select().from(sandbox.sandboxPosts);
    expect(posts).toHaveLength(6 * POSTS_PER_DAY);
    // The retried account wrote its channel's same inputs (the first answer's plan).
    for (const platform of ["x", "substack"]) {
      const mine = posts.filter((p) => p.accountId.startsWith(`${platform}:`));
      expect(new Set(mine.map((p) => `${p.slot}:${p.angle}:${p.input.label}`)).size).toBe(POSTS_PER_DAY);
    }
  });

  it("skills: each channel x tone file exists with its Image section; an Article must be an object; a picture must use a listed chart and point", async () => {
    for (const p of ["x", "substack"] as const) for (const t of ["urgent", "balanced", "neutral"]) {
      const { text } = await loadSkills(p, t);
      expect(text).toMatch(/angle: competitor/i);
      expect(text).toMatch(/## Image/);
    }
    const charts = [{ id: "price", label: "Price", points: [{ id: "2026-11-01", label: "close 3" }] }];
    const img = '{"chart": "price", "point": "2026-11-01", "style": "pro", "title": "T", "chartLabel": "L", "note": "N", "priceSays": "P", "newsLine": null, "news": null}';
    const plans = [{ article: false, slot: 0, charts, news: [] }, { article: true, slot: 1, charts, news: [] }];
    expect(() => parsePosts(`{"posts": [{"text": "a", "image": ${img}}, {"text": "b", "image": ${img}}]}`, plans)).toThrow(/not an article/);
    expect(parsePosts(`{"posts": [{"post": 2, "title": "T", "body": "B", "image": ${img}}, {"post": 1, "text": "short", "image": ${img}}]}`, plans).map((p) => p.title ?? p.text)).toEqual(["short", "T"]);
    expect(() => parsePosts(`{"posts": [{"text": "a"}]}`, plans.slice(0, 1))).toThrow(/has no image/);
    expect(() => parsePosts(`{"posts": [{"text": "a", "image": ${img.replace('"price"', '"exhibit-x"')}}]}`, plans.slice(0, 1))).toThrow(/not a chart listed/);
    expect(() => parsePosts(`{"posts": [{"text": "a", "image": ${img.replace("2026-11-01", "2020-01-01")}}]}`, plans.slice(0, 1))).toThrow(/not a point/);
    expect(parsePosts(`{"posts": [{"text": "a", "image": ${img.replace("2026-11-01", "latest")}}]}`, plans.slice(0, 1))[0].image.point).toBe("latest");
  });

  it("review: a failed round edits the writer's skill and the day is written, drawn and reviewed again; a pass stops it", async () => {
    await run(macroNews);
    await run(substackTrending);
    await run(sandboxAccounts);
    reviewPlan.fail = "Siren Small Caps », X,";
    const skill = join(skillsDir, "x-urgent/SKILL.md");
    // The review loop edits the real skills every day: the test edits its own line, never their changing text.
    await writeFile(skill, `${await readFile(skill, "utf8")}\n- **test line**: the note says the number.\n`);
    reviewPlan.edit = { skill: "x-urgent", old: "- **test line**: the note says the number.", new: "- **test line**: the number AND what it measures." };
    await run(sandboxPosts);
    await run(sandboxVisuals);
    await run(sandboxImageFix);
    const r1 = await run(sandboxReview);
    expect(r1.error ?? r1.sources.flatMap((x) => x.errors)).toEqual([]);
    // The reviewer saw each post's picture.
    const reviewCalls = complete.mock.calls.filter(([req]) => req.system.startsWith("You review the Sandbox"));
    expect(reviewCalls).toHaveLength(6);
    expect(reviewCalls.every(([req]) => req.images?.length === POSTS_PER_DAY)).toBe(true);
    const reviews = await db.select().from(sandbox.sandboxReviews);
    expect(reviews.filter((r) => !r.pass).map((r) => r.accountId)).toEqual(["x:sirensmallcaps"]);
    expect(reviews.find((r) => !r.pass)?.edits).toMatchObject([{ skill: "x-urgent", applied: true }]);
    expect(await readFile(skill, "utf8")).toMatch(/AND what it measures/);
    // Only the failed account writes again, as round 2, with the edited skill.
    expect(await sandboxPostSubjects(db)).toEqual([`x:sirensmallcaps|${new Date().toISOString().slice(0, 10)}|2`]);
    await run(sandboxPosts);
    expect(complete.mock.calls.at(-1)![0].system).toMatch(/AND what it measures/);
    await run(sandboxVisuals);
    await run(sandboxImageFix);
    await run(sandboxReview);
    const gold = await db.select().from(sandbox.goldSandboxPosts).where(eq(sandbox.goldSandboxPosts.accountId, "x:sirensmallcaps"));
    const round2 = await db.select({ id: sandbox.sandboxPosts.id }).from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.round, 2));
    expect(gold.map((p) => p.id).sort()).toEqual(round2.map((p) => p.id).sort());
    expect(gold.every((p) => p.visualId)).toBe(true);
    expect((await db.select().from(sandbox.sandboxReviews)).filter((r) => r.round === 2).map((r) => r.pass)).toEqual([true]);
    expect(await sandboxPostSubjects(db)).toEqual([]);
  }, 60_000);

  it("a day written before posts carried a picture is written again as the next round", async () => {
    await run(sandboxAccounts);
    await run(sandboxPosts);
    await db.update(sandbox.sandboxPosts).set({ image: null }).where(eq(sandbox.sandboxPosts.accountId, "x:narrativegap"));
    expect(await sandboxPostSubjects(db)).toEqual([`x:narrativegap|${new Date().toISOString().slice(0, 10)}|2`]);
  });

  it("opportunity frame: a company with a driver reversing now gets the narrative + one chart per reversing driver, on every account", async () => {
    const day = (i: number) => new Date(Date.now() - (8 - i) * 91 * 86400_000).toISOString().slice(0, 10);
    await db.insert(exhibits).values({ id: "CCLD:long:1:1", symbol: "CCLD", driverId: "CCLD:long:1", rank: 1, number: 1, title: "Revenue per quarter, $", chart: "line", series: [{ key: "revenue", label: "Revenue", unit: "usd", currency: "USD" } as never], points: Array.from({ length: 8 }, (_, i) => ({ period: day(i), values: { revenue: (40 + i) * 1e6 } })), takeaway: "t", sources: ["Company filings (SEC EDGAR)"] });
    await db.insert(narrativeStates).values({ id: "CCLD:long:driver:1", symbol: "CCLD", side: "long", level: "driver", driverId: "CCLD:long:1", effect: "reversal", strength: "strong", why: "w", probability: 0.9, evidenceIds: [], headline: "Revenue up 7% in Q3", judgmentId: crypto.randomUUID(), asOf: new Date() });
    await db.insert(fairValues).values({ symbol: "CCLD", value: 6, currency: "USD", low: 5, high: 7, author: "claude", inputs: [] });
    const story = await opportunityStory(db, "CCLD");
    expect(story?.drivers.map((d) => [d.title, d.tag, d.headline])).toEqual([["Client loss", "STRONG INFLECTION", "Revenue up 7% in Q3"]]);
    // With a judge, the line's compared period is the one before the latest (boxed with it, the arrow between them).
    const judged = await opportunityStory(db, "CCLD", complete);
    expect(judged?.drivers[0].base).toBe(day(6));
    await run(macroNews);
    await run(sandboxAccounts);
    await run(sandboxPosts);
    const report = await run(sandboxVisuals);
    expect(report.error ?? report.sources.flatMap((x) => x.errors)).toEqual([]);
    const own = await db.select({ caption: sandbox.sandboxVisuals.caption, kind: sandbox.sandboxVisuals.kind }).from(sandbox.sandboxVisuals);
    expect(own).toHaveLength(6 * POSTS_PER_DAY);
    expect(own.every((v) => v.caption === "Opportunity: Client loss")).toBe(true);
    // The frame comes from the analysis: no chart callout asked, and the compared period judged ONCE for 30 pictures.
    expect(complete.mock.calls.filter(([req]) => /CALLOUT/.test(req.system))).toHaveLength(0);
    expect(complete.mock.calls.filter(([req]) => req.system.startsWith("You judge"))).toHaveLength(1);
  }, 60_000);

  it("image correction: a defective picture gets a corrected spec and is drawn again; the review waits for clean pictures", async () => {
    await run(macroNews);
    await run(sandboxAccounts);
    fixPlan.fixFirst = "Ledger and Lens », X,";
    await run(sandboxPosts);
    await run(sandboxVisuals);
    const fix1 = await run(sandboxImageFix);
    expect(fix1.error ?? fix1.sources.flatMap((x) => x.errors)).toEqual([]);
    // The corrector saw the 5 pictures; post 1 of @ledgerlens is corrected, waits for its new picture.
    const fixCalls = complete.mock.calls.filter(([req]) => req.system.startsWith("You correct the pictures"));
    expect(fixCalls).toHaveLength(6);
    expect(fixCalls.every(([req]) => req.images?.length === POSTS_PER_DAY)).toBe(true);
    const [fixed] = await db.select().from(sandbox.sandboxPosts).where(and(eq(sandbox.sandboxPosts.accountId, "x:ledgerlens"), eq(sandbox.sandboxPosts.slot, 0)));
    expect(fixed).toMatchObject({ imageVersion: 2, visualId: null });
    expect(fixed.image?.chartLabel).toBe("Share price, $, last 12 months");
    await run(sandboxReview);
    expect((await db.select().from(sandbox.sandboxReviews)).map((r) => r.accountId)).not.toContain("x:ledgerlens");
    // Drawn again under a new key, looked at again (clean), then reviewed.
    await run(sandboxVisuals);
    const [redrawn] = await db.select().from(sandbox.sandboxPosts).where(eq(sandbox.sandboxPosts.id, fixed.id));
    expect((await db.select().from(sandbox.sandboxVisuals).where(eq(sandbox.sandboxVisuals.id, redrawn.visualId!)))[0].key).toBe(postKey(fixed.id, 2));
    await run(sandboxImageFix);
    const checks = await db.select().from(sandbox.sandboxImageChecks).where(eq(sandbox.sandboxImageChecks.accountId, "x:ledgerlens"));
    expect(checks.map((c) => [c.pass, c.allOk])).toEqual(expect.arrayContaining([[1, false], [2, true]]));
    await run(sandboxReview);
    expect((await db.select().from(sandbox.sandboxReviews)).map((r) => r.accountId)).toContain("x:ledgerlens");
  }, 60_000);

  it("review: a drawing defect fails the post with no skill edit to make", async () => {
    const { parseReview } = await import("../sandbox-review");
    const drawing = JSON.stringify({ posts: [{ post: 1, imageAlone: false, aligned: true, clear: true, why: "Drawing: the price card pill reads % below fair val." }], edits: [] });
    expect(parseReview(drawing, 1, ["x-urgent"]).posts[0].imageAlone).toBe(false);
    expect(() => parseReview(drawing.replace("Drawing: ", ""), 1, ["x-urgent"])).toThrow(/edits no skill/);
  });

  it("review: an edit whose text is not in the skill is kept as not applied, with why", async () => {
    await run(macroNews);
    await run(sandboxAccounts);
    reviewPlan.fail = "Siren Small Caps », X,";
    reviewPlan.edit = { skill: "x-urgent", old: "a line that is nowhere", new: "x" };
    await run(sandboxPosts);
    await run(sandboxVisuals);
    await run(sandboxImageFix);
    await run(sandboxReview);
    const [r] = (await db.select().from(sandbox.sandboxReviews)).filter((x) => !x.pass);
    expect(r.edits).toMatchObject([{ applied: false, reason: expect.stringMatching(/not found/) }]);
  }, 60_000);
});
