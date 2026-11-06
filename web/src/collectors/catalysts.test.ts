import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { catalystEvents, goldCatalysts } from "@/db/schema/catalysts";
import { filings } from "@/db/schema/gold";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { analyseEveryTicker, testDb } from "@/test/db";
import { catalystsDimension, pendingSubjects } from "./dimensions/catalysts";
import { CATALYST_MIN_PROBABILITY } from "./dimensions/catalysts/gold";
import { seedThesis } from "@/test/thesis-fixture";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const ctx: SourceContext = { env: { REPO_ROOT }, fetch: (async () => new Response("{}")) as typeof fetch };
const HOUR = 3600_000;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx });
  await analyseEveryTicker(db);
  await seedThesis(db, ["MNRO", "LESL", "BOOT", "PLBY"]);
});
afterEach(async () => close());

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One article in gold, tied to the given tickers. */
async function article(n: number, title: string, symbols: string[], opts: { publishedAt?: Date; sources?: string[] } = {}) {
  const publishedAt = opts.publishedAt ?? new Date(Date.now() - 2 * HOUR);
  const sources = opts.sources ?? ["google-news"];
  await db.insert(goldNewsItems).values({
    id: ID(n),
    title,
    url: `https://example.com/${n}`,
    publisher: "Reuters",
    summary: `${title}. More details follow.`,
    publishedAt,
    firstSeenAt: publishedAt,
    sources,
    symbols,
    markets: ["US"],
  });
  for (const symbol of symbols) {
    await db.insert(goldNewsLinks).values({
      newsItemId: ID(n),
      symbol,
      market: "US",
      publishedAt,
      firstSeenAt: publishedAt,
      matchKinds: ["name"],
      matchedTerms: [symbol],
      sources,
      matches: [{ kind: "name", term: symbol, sources }],
    });
  }
}

/** One filing of a ticker in gold. */
async function filing(n: number, title: string, symbol: string, filedAt = new Date(Date.now() - 3 * HOUR)) {
  await db.insert(filings).values({ id: ID(n), symbol, registry: "sec-edgar", filingKey: `k${n}`, form: "8-K", title, filedAt, url: `https://sec.gov/${n}`, language: "en", sources: ["sec-edgar"] });
}

/** Fake judge: the verdict is written in the title, e.g. "[contradicts 0.9] Monro raises guidance". */
function fakeJudge() {
  return vi.fn<Complete>(async ({ prompt }) => {
    const m = /Title: (?:8-K: )?\[(\S+) ([\d.]+)\] (.*)/.exec(prompt);
    const verdict = m?.[1] ?? "none";
    const probability = Number(m?.[2] ?? 0.9);
    const cited = prompt.split("\n").find((l) => l.startsWith("Title: "))!.slice(7);
    return { text: JSON.stringify({ verdict, probability, cited_sentence: cited, reason: `Because ${verdict}.` }), model: "fake" };
  });
}

describe("catalysts dimension: each item judged against the market's narrative", () => {
  it("judges each (ticker, article) once, with the narrative and the view in the question", async () => {
    await article(1, "[contradicts 0.9] Monro raises full year guidance", ["MNRO"]);
    const complete = fakeJudge();
    const report = await runDimension(db, catalystsDimension(complete), { trigger: "test", ctx });
    expect(report.status).toBe("succeeded");
    expect(complete).toHaveBeenCalledTimes(1);
    const { prompt } = complete.mock.calls[0][0];
    expect(prompt).toContain("The market's narrative (what the price reflects): Investors see MNRO as a shrinking business.");
    expect(prompt).toContain("The analyst's view of it: New contracts show MNRO is growing again.");
    expect(prompt).toContain("Allowed choices: contradicts, continues, none");

    const bronze = await db.select().from(fetches).where(eq(fetches.dimension, "catalysts"));
    expect(bronze).toHaveLength(1);
    expect(bronze[0]).toMatchObject({ source: "claude", subject: `news:MNRO|${ID(1)}`, error: null });
    expect(bronze[0].payload).toMatchObject({ verdict: "contradicts", reason: "Because contradicts." });
  });

  it("judgment once: a second run asks nothing and adds no bronze row", async () => {
    await article(1, "[contradicts 0.9] Monro raises full year guidance", ["MNRO"]);
    await article(2, "[none 0.95] Five stocks to watch this week", ["MNRO", "LESL"]);
    const complete = fakeJudge();
    await runDimension(db, catalystsDimension(complete), { trigger: "test", ctx });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(await pendingSubjects(db)).toEqual([]);
    const second = await runDimension(db, catalystsDimension(complete), { trigger: "test", ctx });
    expect(second.sources.reduce((n, src) => n + src.requested, 0)).toBe(0);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(await db.select().from(judgments)).toHaveLength(3);
  });

  it("filings are judged too, and a ticker with no narrative is not", async () => {
    await filing(5, "[continues 0.8] Results of operations", "MNRO");
    await filing(6, "[contradicts 0.8] Officer departs", "CNRD");
    await filing(7, "[contradicts 0.8] Old filing", "MNRO", new Date(Date.now() - 10 * 24 * HOUR));
    const complete = fakeJudge();
    await runDimension(db, catalystsDimension(complete), { trigger: "test", ctx });
    expect(complete).toHaveBeenCalledTimes(1); // CNRD has no thesis, the old filing is outside the horizon
    const [g] = await db.select().from(goldCatalysts);
    expect(g).toMatchObject({ symbol: "MNRO", kind: "filing", direction: "continues", headline: "8-K: [continues 0.8] Results of operations", url: "https://sec.gov/5", publisher: "sec-edgar" });
    expect(g.filingIds).toEqual([ID(5)]);
  });

  it("several items on one ticker, direction and day = ONE event carrying every item and every source tag", async () => {
    const at = new Date(Date.now() - 3 * HOUR);
    await article(1, "[contradicts 0.8] Monro wins fleet contract", ["MNRO"], { publishedAt: at, sources: ["google-news"] });
    await article(2, "[contradicts 0.92] Monro signs national fleet deal", ["MNRO"], { publishedAt: new Date(at.getTime() + HOUR), sources: ["finnhub", "yahoo"] });
    await article(3, "[continues 0.75] Monro margin squeezed by tire costs", ["MNRO"], { publishedAt: at });
    await runDimension(db, catalystsDimension(fakeJudge()), { trigger: "test", ctx });

    const events = await db.select().from(catalystEvents).where(eq(catalystEvents.direction, "contradicts"));
    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e.newsItemIds.sort()).toEqual([ID(1), ID(2)]);
    expect(e.sources).toEqual(["claude", "finnhub", "google-news", "yahoo"]);
    expect(e.probability).toBeCloseTo(0.92, 5);
    expect(e.topItem).toBe(`news:${ID(2)}`);
    expect(e.eventAt.getTime()).toBe(at.getTime());
    expect(await db.select().from(catalystEvents)).toHaveLength(2);
  });

  it("gold keeps only items at or above the bar, with the article's title, link and publisher", async () => {
    await article(1, "[contradicts 0.9] Monro raises full year guidance", ["MNRO"]);
    await article(2, `[continues ${CATALYST_MIN_PROBABILITY - 0.2}] Leslie's mentions pool season`, ["LESL"]);
    await article(3, "[none 0.95] Five stocks to watch", ["BOOT"]);
    await runDimension(db, catalystsDimension(fakeJudge()), { trigger: "test", ctx });
    const gold = await db.select().from(goldCatalysts);
    expect(gold).toHaveLength(1);
    expect(gold[0]).toMatchObject({ symbol: "MNRO", kind: "news", direction: "contradicts", headline: "[contradicts 0.9] Monro raises full year guidance", url: "https://example.com/1", publisher: "Reuters" });
    expect(await db.select().from(catalystEvents)).toHaveLength(2); // the low one stays in silver
  });
});
