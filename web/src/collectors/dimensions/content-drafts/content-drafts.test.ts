import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { addAccount, requestDraft, setDraftStatus } from "@/content/manual";
import { canDispatch, dispatchDraftWriter } from "@/content/dispatch";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentDrafts } from ".";
import { draftSystem, parseGeneration, publishLink, SHORT_DISCLAIMER, stripDashes, withDisclaimer } from "./format";

const ARTICLE = JSON.stringify({
  title: "CareCloud found its new client",
  subtitle: "The market still prices the old one — gone.",
  body: "## 1. The business\nBilling software.\n\n[EXHIBIT price]\n\n## 3. What changed\nA new client.",
});

/** Fake writer: the article format gets JSON, the short formats plain text naming the account. */
function fakeComplete(opts: { article?: string; fail?: boolean } = {}) {
  return vi.fn<Complete>(async ({ system }) => {
    if (opts.fail) return { text: "", model: "fake" };
    if (system.includes("Format: one full Substack article")) return { text: opts.article ?? ARTICLE, model: "fake" };
    const account = system.match(/Account: (.*)/)?.[1] ?? "?";
    return { text: `$CCLD post for ${account} — sourced.`, model: "fake" };
  });
}

let db: Db;
let close: () => Promise<void>;
let ideaId: string;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (30 - i) * 86400_000).toISOString().slice(0, 10));
  await db.insert(gold.priceBars).values(days.map((date, i) => ({ symbol: "CCLD", date, close: 3 + i / 30, sources: ["yahoo"], alternatives: [] })));
  // LinkedIn: Thierry's own account and his fund's; Thierry's voice wins.
  await addAccount(db, { channel: "linkedin", owner: "duality", name: "Duality Asset Management", address: "linkedin.com/company/duality-asset-management" }, null);
  await addAccount(db, { channel: "linkedin", owner: "thierry", name: "Thierry Matin", address: "linkedin.com/in/thierrymatin" }, null);
  await db.insert(content.contentVoices).values({ accountId: "linkedin:thierrymatin", inputKey: "k", guide: "VOICE-THIERRY-LI", basis: "test", model: "fake", sources: ["claude"], bronzeIds: [] });
  const [idea] = await db
    .insert(content.contentIdeas)
    .values({
      generationBronzeId: crypto.randomUUID(), rank: 1, day: new Date().toISOString().slice(0, 10), symbol: "CCLD",
      title: "CareCloud replaced the client the market thinks it lost.", angle: "Reuters reports a new hospital client.",
      sourceRefs: [{ kind: "evidence", ref: "evidence:CCLD|news:n1", symbol: "CCLD", label: "CCLD signs a new hospital client" }],
      model: "fake", sources: ["claude"], bronzeIds: [],
    })
    .returning();
  ideaId = idea.id;
  await db.insert(content.goldContentIdeas).values({ ...idea, companyName: "CareCloud", scores: [], bestFormat: null, bestScore: null, requests: [], draftCount: 0 });
});
afterEach(async () => close());

const ctx = (complete: Complete) => ({ env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch, complete });
const goldIdea = async () => (await db.select().from(content.goldContentIdeas).where(eq(content.goldContentIdeas.id, ideaId)))[0];

describe("content-drafts dimension", () => {
  it("writes a draft only when asked: one Idea x one format, in the voice of Thierry's account on that channel", async () => {
    const idle = fakeComplete();
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(idle) });
    expect(idle).not.toHaveBeenCalled();

    await requestDraft(db, ideaId, "linkedin-post", "user_1");
    await requestDraft(db, ideaId, "linkedin-post", "user_1"); // double click: still one pending request
    expect((await goldIdea()).requests).toMatchObject([{ format: "linkedin-post", status: "pending" }]);

    const complete = fakeComplete();
    const report = await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    expect(report.status).toBe("succeeded");
    expect(complete).toHaveBeenCalledTimes(1);
    const { system, prompt } = complete.mock.calls[0][0];
    expect(system).toContain("Account: Thierry Matin");
    expect(system).toContain("VOICE-THIERRY-LI");
    // Breaking-news alarm, the short name, no licence to hedge (Kevin 2026-11-09: « pas assez alarmist »).
    expect(system).toContain("🚨 CareCloud: ");
    expect(system).toContain("Tone: alarm.");
    expect(system).not.toMatch(/Stay honest about what is not proven|calm, precise/);
    expect(prompt).toContain("Idea: CareCloud replaced the client the market thinks it lost.");
    expect(prompt).toContain("CCLD signs a new hospital client");
    expect(prompt).toContain("Fair value: 6 USD (8x EV/EBITDA)");

    const [draft] = await db.select().from(content.contentDrafts);
    expect(draft).toMatchObject({ ideaId, inputKey: `idea:${ideaId}`, format: "linkedin-post", accountId: "linkedin:thierrymatin", body: "$CCLD post for Thierry Matin, sourced.", scheduledAt: null });
    const g = await goldIdea();
    expect(g.requests).toMatchObject([{ status: "done", draftId: draft.id }]);
    expect(g.draftCount).toBe(1);
    const [gd] = await db.select().from(content.goldContentDrafts);
    expect(gd).toMatchObject({ ideaId, body: `$CCLD post for Thierry Matin, sourced.\n\n${SHORT_DISCLAIMER}` });

    // Nothing pending: the next run asks nothing.
    const again = fakeComplete();
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(again) });
    expect(again).not.toHaveBeenCalled();
  });

  it("an article gets the price exhibit; Draft again makes version 2", async () => {
    await requestDraft(db, ideaId, "substack-article", null);
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete()) });
    await requestDraft(db, ideaId, "substack-article", null);
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete()) });
    const drafts = await db.select().from(content.contentDrafts).orderBy(content.contentDrafts.version);
    expect(drafts.map((d) => d.version)).toEqual([1, 2]);
    expect(drafts[0].charts?.[0]).toMatchObject({ kind: "price", title: "CareCloud share price" });
    expect(await db.select().from(content.goldContentDrafts)).toHaveLength(1);
  });

  it("a failed generation marks the request failed with its reason, and it can be asked again", async () => {
    await requestDraft(db, ideaId, "x-post", null);
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete({ fail: true })) });
    expect(await db.select().from(content.contentDrafts)).toHaveLength(0);
    expect((await goldIdea()).requests).toMatchObject([{ status: "failed", error: expect.stringMatching(/empty/) }]);
    await requestDraft(db, ideaId, "x-post", null);
    expect((await goldIdea()).requests.map((r) => r.status)).toEqual(["pending", "failed"]);
  });

  it("refuses an unknown idea or format", async () => {
    await expect(requestDraft(db, crypto.randomUUID(), "x-post", null)).rejects.toThrow(/not found/);
    await expect(requestDraft(db, ideaId, "tiktok" as never, null)).rejects.toThrow(/unknown format/);
  });

  it("mark posted puts the draft in the publication history; back to review takes it out", async () => {
    await requestDraft(db, ideaId, "x-post", null);
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete()) });
    const [draft] = await db.select().from(content.contentDrafts);
    await setDraftStatus(db, draft.id, "posted", { postedUrl: "https://x.com/dualis/status/1", userId: "user_1" });
    const [after] = await db.select().from(content.contentDrafts).where(sql`id = ${draft.id}`);
    expect(after).toMatchObject({ status: "posted", postedUrl: "https://x.com/dualis/status/1", sources: ["claude", "console"] });
    expect(await db.select().from(content.goldContentPublished)).toMatchObject([{ id: `draft:${draft.id}`, format: "x-post", tickers: ["CCLD"], url: "https://x.com/dualis/status/1", source: "console" }]);
    await setDraftStatus(db, draft.id, "draft", { userId: "user_1" });
    expect(await db.select().from(content.goldContentPublished)).toHaveLength(0);
  });
});

describe("draft writer dispatch", () => {
  it("does nothing without a token; with one, starts draft.yml on main and fails loud on a refusal", async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(canDispatch({})).toBe(false);
    expect(await dispatchDraftWriter({}, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await dispatchDraftWriter({ DRAFT_DISPATCH_TOKEN: "tok" }, f)).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/KevinLourd/dualis-research/actions/workflows/draft.yml/dispatches");
    expect(JSON.parse(String(init?.body))).toEqual({ ref: "main", inputs: {} });
    const refused = vi.fn<typeof fetch>(async () => new Response("Bad credentials", { status: 401 }));
    await expect(dispatchDraftWriter({ DRAFT_DISPATCH_TOKEN: "tok" }, refused)).rejects.toThrow(/401 Bad credentials/);
  });
});

describe("draft format", () => {
  it("asks for a Note as one small paragraph with a chart, an X post smaller still", () => {
    const note = draftSystem("substack-note", null, "Analysis Paralysis");
    expect(note).toMatch(/one small paragraph with a chart/);
    expect(note).toMatch(/2 or 3 short sentences/);
    expect(note).not.toMatch(/5 to 8 lines/);
    expect(draftSystem("x-post", null, null)).toMatch(/at most 160 characters/);
    expect(note).toMatch(/update on the company/);
  });
  it("strips em and en dashes but keeps hyphens", () => {
    expect(stripDashes("Sales rose — new stores – carry it; same-store")).toBe("Sales rose, new stores, carry it; same-store");
  });
  it("puts inline exhibit markers on their own line and never shows an exhibit id to the reader", () => {
    const answer = JSON.stringify({ title: "T", subtitle: "S", body: "Revenue grew. [EXHIBIT E.TO:11] Exhibit E.TO:11 shows it.\n\n[EXHIBIT 1]" });
    const g = parseGeneration("substack-article", answer, ["price", "E.TO:11"]);
    expect(g.exhibitIds).toEqual(["E.TO:11", "price"]);
    expect(g.body).toContain("Revenue grew.\n\n[EXHIBIT 1]\n\nExhibit 1 shows it.");
    expect(g.body).not.toContain("E.TO:11");
  });
  it("short formats are the text itself; an article needs its JSON", () => {
    expect(parseGeneration("x-post", " $BOOT up ").body).toBe("$BOOT up");
    expect(() => parseGeneration("substack-article", '{"title":"a"}', [])).toThrow(/subtitle/);
  });
  it("adds the disclaimer and builds one-click links", () => {
    expect(withDisclaimer("x-post", "Hi")).toBe(`Hi\n\n${SHORT_DISCLAIMER}`);
    expect(publishLink("x-post", "a b")?.href).toBe("https://x.com/intent/post?text=a%20b");
  });
});
