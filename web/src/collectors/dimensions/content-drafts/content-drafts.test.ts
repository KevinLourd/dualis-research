import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { goldCatalysts } from "@/db/schema/catalysts";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import { goldNewsItems } from "@/db/schema/news";
import { theses as goldTheses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { addAccount, setDraftStatus } from "@/content/manual";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentDrafts, promoteDrafts, slotsFor } from ".";
import { parseGeneration, publishLink, SHORT_DISCLAIMER, stripDashes, withDisclaimer } from "./format";

const ARTICLE = JSON.stringify({
  title: "Boot Barn is a store rollout story",
  subtitle: "Same store sales slowed — new stores carry it.",
  body: "## 1. The business\nBoot Barn sells boots.\n\n[EXHIBIT price]\n\n## 2. Our view\nStores matter.\n\n[EXHIBIT not-offered]\n\n[EXHIBIT BOOT:1]",
});

/** Fake writer: the article format gets JSON, the short formats plain text naming the account. */
function fakeComplete(article = ARTICLE) {
  return vi.fn<Complete>(async ({ system }) => {
    if (system.includes("Format: one full Substack article")) return { text: article, model: "fake" };
    const account = system.match(/Account: (.*)/)?.[1] ?? "?";
    return { text: `$BOOT post for ${account} — sourced.`, model: "fake" };
  });
}

const DAY = new Date().toISOString().slice(0, 10);
async function addCatalyst(db: Db, symbol: string, opts: { direction?: "contradicts" | "continues"; kind?: "news" | "filing"; probability?: number; hoursAgo?: number } = {}) {
  const at = new Date(Date.now() - (opts.hoursAgo ?? 2) * 3600_000);
  const newsId = crypto.randomUUID();
  await db.insert(goldNewsItems).values({ id: newsId, title: `${symbol} news`, url: `https://news.example/${newsId}`, publisher: "Reuters", summary: "summary", publishedAt: at, firstSeenAt: at, sources: ["test"], symbols: [symbol], markets: ["US"] });
  const id = `${symbol}:${opts.direction ?? "contradicts"}:${DAY}:${newsId.slice(0, 4)}`;
  await db.insert(goldCatalysts).values({
    id, symbol, kind: opts.kind ?? "news", eventDay: DAY, eventAt: at,
    direction: opts.direction ?? "contradicts", probability: opts.probability ?? 0.8, reason: "it cracks the story", evidence: "Sales rose 4%.",
    headline: `${symbol} news`, url: `https://news.example/${newsId}`, publisher: "Reuters", newsItemIds: [newsId], filingIds: [], sources: ["test", "claude"],
  });
  return id;
}

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  for (const symbol of ["BOOT", "MNRO"]) {
    await db.insert(gold.companyProfiles).values({ symbol, name: `${symbol} Inc.`, provenance: {} });
    await db.insert(goldTheses).values({ symbol, narrative: `Investors see ${symbol} as a fad`, summary: `${symbol} thesis`, summaryState: "draft" });
  }
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (30 - i) * 86400_000).toISOString().slice(0, 10));
  await db.insert(gold.priceBars).values(days.map((date, i) => ({ symbol: "BOOT", date, close: 100 + i, sources: ["yahoo"], alternatives: [] })));
  // Accounts: one Substack, two LinkedIn (Thierry + his fund), no X account yet.
  await addAccount(db, { channel: "substack", owner: "thierry", name: "Analysis Paralysis", address: "analysisparalysis888.substack.com" }, null);
  await addAccount(db, { channel: "linkedin", owner: "thierry", name: "Thierry Matin", address: "linkedin.com/in/thierrymatin" }, null);
  await addAccount(db, { channel: "linkedin", owner: "duality", name: "Duality Asset Management", address: "linkedin.com/company/duality-asset-management" }, null);
  await db.insert(content.contentVoices).values({ accountId: "linkedin:thierrymatin", inputKey: "k", guide: "VOICE-THIERRY-LI", basis: "test", model: "fake", sources: ["claude"], bronzeIds: [] });
});
afterEach(async () => close());

const ctx = (complete: Complete) => ({ env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch, complete });

describe("content-drafts dimension", () => {
  it("drafts every news that CONTRADICTS the market narrative, per account and format, in that account's voice", async () => {
    const strong = await addCatalyst(db, "BOOT", { probability: 0.9 });
    await addCatalyst(db, "MNRO", { probability: 0.6 });
    await addCatalyst(db, "MNRO", { direction: "continues" });
    await addCatalyst(db, "BOOT", { kind: "filing" });
    await addCatalyst(db, "BOOT", { hoursAgo: 60 });
    const complete = fakeComplete();

    const report = await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    expect(report.status).toBe("succeeded");
    // 2 contradicting news catalysts x (X unassigned + 2 LinkedIn + Substack note + Substack article) = 10 generations.
    expect(complete).toHaveBeenCalledTimes(10);
    const drafts = await db.select().from(content.contentDrafts);
    expect(drafts).toHaveLength(10);
    expect(drafts.filter((d) => d.format === "x-post").every((d) => d.accountId === null)).toBe(true);
    expect(new Set(drafts.filter((d) => d.format === "linkedin-post").map((d) => d.accountId))).toEqual(new Set(["linkedin:thierrymatin", "linkedin:duality-asset-management"]));
    const systems = complete.mock.calls.map(([r]) => r.system);
    expect(systems.some((s) => s.includes("Account: Thierry Matin") && s.includes("VOICE-THIERRY-LI"))).toBe(true);

    // Slots: the strongest catalyst first, all its channels in the same slot, within the next 24 hours.
    const boot = drafts.filter((d) => d.inputKey === strong);
    const mnro = drafts.filter((d) => d.inputKey !== strong);
    expect(new Set(boot.map((d) => d.scheduledAt!.getTime())).size).toBe(1);
    expect(boot[0].scheduledAt!.getTime()).toBeLessThan(mnro[0].scheduledAt!.getTime());
    expect(mnro[0].scheduledAt!.getTime() - Date.now()).toBeLessThan(24 * 3600_000);

    // Article: charts snapshot from gold, only the offered exhibits, renumbered in order; dashes stripped.
    const article = drafts.find((d) => d.format === "substack-article" && d.symbol === "BOOT")!;
    expect(article.charts!.map((c) => c.kind)).toEqual(["price"]);
    expect(article.charts![0].points).toHaveLength(30);
    expect(article.body).toContain("[EXHIBIT 1]");
    expect(article.body).not.toContain("not-offered");
    expect(article.body).not.toMatch(/[—–]/);
    expect(article.inputs.catalyst).toMatchObject({ id: strong, direction: "contradicts" });
    expect(complete.mock.calls.some(([r]) => r.prompt.includes("What the market believes: Investors see BOOT as a fad"))).toBe(true);

    const goldDrafts = await db.select().from(content.goldContentDrafts);
    expect(goldDrafts).toHaveLength(10);
    expect(goldDrafts.every((d) => d.body.includes("Not investment advice."))).toBe(true);
    expect(goldDrafts.find((d) => d.accountId === "linkedin:duality-asset-management")?.accountName).toBe("Duality Asset Management");
  });

  it("asks nothing twice: a second run and a re-promotion write no new draft, even unassigned ones", async () => {
    await addCatalyst(db, "BOOT");
    const complete = fakeComplete();
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(5);
    await promoteDrafts(db, await db.select().from(fetches));
    expect(await db.select().from(content.contentDrafts)).toHaveLength(5);
  });

  it("a new account gets its drafts on the next run, the others are not rewritten", async () => {
    await addCatalyst(db, "BOOT");
    const complete = fakeComplete();
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    await addAccount(db, { channel: "x", owner: "thierry", name: "Thierry on X", address: "@thierry" }, null);
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(6);
    expect((await db.select().from(content.contentDrafts)).filter((d) => d.accountId === "x:thierry")).toHaveLength(1);
  });

  it("never drafts a ticker without a thesis", async () => {
    await db.execute(sql`delete from gold.theses where symbol = 'BOOT'`);
    await addCatalyst(db, "BOOT");
    const complete = fakeComplete();
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(complete) });
    expect(complete).not.toHaveBeenCalled();
  });

  it("a malformed article answer lands in bronze as a failed fetch, never as a draft", async () => {
    await addCatalyst(db, "BOOT");
    const report = await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete("Sorry, I cannot.")) });
    expect(report.status).toBe("partial");
    const failed = (await db.select().from(fetches)).filter((f) => f.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].payloadText).toBe("Sorry, I cannot.");
    expect((await db.select().from(content.contentDrafts)).some((d) => d.format === "substack-article")).toBe(false);
  });

  it("Thierry's approve and mark posted land in bronze, silver and gold", async () => {
    await addCatalyst(db, "BOOT");
    await runDimension(db, contentDrafts, { trigger: "test", ctx: ctx(fakeComplete()) });
    const [draft] = await db.select().from(content.contentDrafts).where(sql`format = 'x-post'`);
    await setDraftStatus(db, draft.id, "posted", { postedUrl: "https://x.com/dualis/status/1", userId: "user_1" });
    const [after] = await db.select().from(content.contentDrafts).where(sql`id = ${draft.id}`);
    expect(after).toMatchObject({ status: "posted", postedUrl: "https://x.com/dualis/status/1", sources: ["claude", "console"] });
    const [g] = await db.select().from(content.goldContentDrafts).where(sql`id = ${draft.id}`);
    expect(g.status).toBe("posted");
  });
});

describe("draft format", () => {
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
  it("spreads slots evenly over 24 hours", () => {
    const start = new Date("2026-11-05T05:15:00Z");
    const slots = slotsFor(["a", "b", "c", "d"], start);
    expect(slots.get("a")!.toISOString()).toBe("2026-11-05T08:15:00.000Z");
    expect(slots.get("d")!.toISOString()).toBe("2026-11-06T02:15:00.000Z");
  });
  it("adds the disclaimer and builds one-click links", () => {
    expect(withDisclaimer("x-post", "Hi")).toBe(`Hi\n\n${SHORT_DISCLAIMER}`);
    expect(publishLink("x-post", "a b")?.href).toBe("https://x.com/intent/post?text=a%20b");
  });
});
