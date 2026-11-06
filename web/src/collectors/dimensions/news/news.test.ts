import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { goldNewsItems, goldNewsLinks, newsItems, newsMentions } from "@/db/schema/news";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { runDimension } from "../../runner";
import type { SourceContext } from "../../types";
import { companyProfile } from "../company-profile";
import { watchlist } from "../watchlist";
import { news } from ".";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const env = { REPO_ROOT, FINNHUB_API_KEY: "fh-secret" };
const PUBLISHED = "Tue, 03 Nov 2026 12:00:00 GMT";
const EPOCH = Date.parse("2026-11-03T11:00:00Z") / 1000;

const rss = (items: { title: string; link: string; source?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${PUBLISHED}</pubDate>${i.source ? `<source url="https://x">${i.source}</source>` : ""}</item>`,
    )
    .join("")}</channel></rss>`;

/** Fake vendors. `yahooTsrc` changes Yahoo's tracking param between runs: same article, new link spelling. */
function fakeFetch(opts: { yahooTsrc: string }) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const text = (body: string, status = 200) => new Response(body, { status });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    // company-profile (names for Google): Yahoo chart only.
    if (url.pathname.startsWith("/v8/finance/chart/")) {
      const symbol = decodeURIComponent(url.pathname.split("/").pop()!);
      const longName = symbol === "MNRO" ? "Monro, Inc." : symbol === "CNRD" ? "Conrad Industries, Inc." : `${symbol} Corp`;
      return json({ chart: { result: [{ meta: { longName, fullExchangeName: "X", currency: "USD" } }] } });
    }
    if (url.host.includes("financialmodelingprep")) return json([]);
    if (url.pathname === "/api/v1/stock/profile2") return json({});
    if (url.pathname === "/api/v1/company-news") {
      expect(url.searchParams.get("token")).toBe("fh-secret");
      if (url.searchParams.get("symbol") !== "MNRO") return json([]);
      return json([
        { headline: "Monro reports second quarter results", url: "https://finnhub.io/api/news?id=1", source: "Yahoo", summary: "Q2.", datetime: EPOCH },
        { headline: "Monro names a new chief financial officer", url: "https://finnhub.io/api/news?id=2", source: "Reuters", summary: "", datetime: EPOCH },
      ]);
    }
    if (url.host === "feeds.finance.yahoo.com") {
      if (url.searchParams.get("s") !== "MNRO") return text(rss([]));
      return text(rss([{ title: "Monro reports second quarter results", link: `https://finance.yahoo.com/news/monro-q2.html?.tsrc=${opts.yahooTsrc}` }]));
    }
    if (url.host === "news.google.com") {
      const q = url.searchParams.get("q")!;
      if (q.startsWith('"LESL"')) return text("Service Unavailable", 503);
      if (q.startsWith('"Monro"')) {
        return text(rss([{ title: "Monro reports second quarter results - Reuters", link: "https://news.google.com/rss/articles/A1", source: "Reuters" }]));
      }
      if (q.includes("Conrad")) {
        return text(rss([{ title: "Conrad Shipyard delivers a new ferry - WorkBoat", link: "https://news.google.com/rss/articles/C1", source: "WorkBoat" }]));
      }
      return text(rss([]));
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

const ctx = (yahooTsrc = "rss"): SourceContext => ({ env, fetch: fakeFetch({ yahooTsrc }) });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await analyseEveryTicker(db);
  await runDimension(db, companyProfile, { trigger: "test", ctx: ctx() });
});
afterEach(async () => close());

describe("news dimension", () => {
  it("lands every raw answer in bronze without the key", async () => {
    const report = await runDimension(db, news, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("partial"); // LESL's Google query failed
    const rows = await db.select().from(fetches).where(eq(fetches.dimension, "news"));
    const bySource = (s: string) => rows.filter((r) => r.source === s).length;
    expect(bySource("google-news")).toBe(37);
    expect(bySource("finnhub")).toBe(report.sources.find((s) => s.source === "finnhub")!.requested);
    expect(JSON.stringify(rows.map((r) => r.request))).not.toContain("fh-secret");
  });

  it("dedups one story across three sources into ONE item with every source tag", async () => {
    await runDimension(db, news, { trigger: "test", ctx: ctx() });
    const items = await db.select().from(newsItems);
    const q2 = items.filter((i) => i.titleKey === "monro reports second quarter results");
    expect(q2).toHaveLength(1);
    expect([...q2[0].sources].sort()).toEqual(["finnhub", "google-news", "yahoo"]);
    expect(q2[0].bronzeIds).toHaveLength(3);
    expect(q2[0].url).toContain("finance.yahoo.com");

    const mentions = await db.select().from(newsMentions).where(eq(newsMentions.newsItemId, q2[0].id));
    expect(mentions.map((m) => [m.tickerSymbol, m.matchKind, m.matchedTerm, [...m.sources].sort()]).sort()).toEqual([
      ["MNRO", "name", "Monro", ["google-news"]],
      ["MNRO", "symbol", "MNRO", ["finnhub", "yahoo"]],
    ]);
  });

  it("keeps how an alias matched, so a noisy alias is visible", async () => {
    await runDimension(db, news, { trigger: "test", ctx: ctx() });
    const [link] = await db.select().from(goldNewsLinks).where(eq(goldNewsLinks.symbol, "CNRD"));
    expect(link.matchKinds.sort()).toEqual(["alias", "name"]);
    expect(link.matchedTerms.sort()).toEqual(["Conrad Industries", "Conrad Shipyard"]);
    expect(link.matches.map((m) => `${m.kind}:${m.term}:${m.sources.join("+")}`).sort()).toEqual([
      "alias:Conrad Shipyard:google-news",
      "name:Conrad Industries:google-news",
    ]);
  });

  it("gold: global feed + per-ticker links", async () => {
    await runDimension(db, news, { trigger: "test", ctx: ctx() });
    const feed = await db.select().from(goldNewsItems);
    expect(feed.map((i) => i.title).sort()).toEqual([
      "Conrad Shipyard delivers a new ferry",
      "Monro names a new chief financial officer",
      "Monro reports second quarter results",
    ]);
    expect(feed.every((i) => i.symbols.length === 1)).toBe(true);

  });

  it("a second run with a new link spelling adds nothing and keeps first-seen dates", async () => {
    await runDimension(db, news, { trigger: "test", ctx: ctx("rss") });
    const before = await db.select().from(newsItems);
    const mentionsBefore = (await db.select().from(newsMentions)).length;
    await runDimension(db, news, { trigger: "test", ctx: ctx("rss2") });
    const after = await db.select().from(newsItems);
    expect(after).toHaveLength(before.length);
    const seen = (rows: typeof before) => Object.fromEntries(rows.map((r) => [r.id, r.firstSeenAt.getTime()]));
    expect(seen(after)).toEqual(seen(before));
    expect(await db.select().from(newsMentions)).toHaveLength(mentionsBefore);
  });
});
