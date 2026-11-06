import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetches } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import type { SourceContext } from "../../types";
import { addAccount } from "@/content/manual";
import { contentAccounts } from "../content-accounts";
import { contentPosts, REFERENCE_PUBLICATIONS } from ".";
import { resolve } from "node:path";
import { mentionedTickers, parseArchive, parseRss, shortName, urlKey } from "./parse";

const rss = (host: string, items: { slug: string; title: string; text?: string; category?: string }[]) => `<?xml version="1.0"?>
<rss><channel><title><![CDATA[Feed of ${host}]]></title><description><![CDATA[About ${host}]]></description>
${items
  .map(
    (i) => `<item><title><![CDATA[${i.title}]]></title><description><![CDATA[Sub &amp; title]]></description>
<link>https://${host}/p/${i.slug}</link><dc:creator><![CDATA[Author A]]></dc:creator><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
${i.category ? `<category>${i.category}</category>` : ""}<content:encoded><![CDATA[<p>${i.text ?? ""}</p>]]></content:encoded></item>`,
  )
  .join("\n")}
</channel></rss>`;

const archive = (host: string, items: { slug: string; title: string; audience: string; tags?: string[] }[]) =>
  items.map((i) => ({
    title: i.title,
    subtitle: "Sub & title",
    canonical_url: `https://${host}/p/${i.slug}/`,
    post_date: "2026-11-02T10:00:00.000Z",
    audience: i.audience,
    type: "newsletter",
    wordcount: 1200,
    postTags: (i.tags ?? []).map((name) => ({ name })),
    publishedBylines: [{ name: "Author A" }],
  }));

const REPO_ROOT = resolve(__dirname, "../../../../..");
const CITRINI = REFERENCE_PUBLICATIONS[0].host;
const AURELION = REFERENCE_PUBLICATIONS[1].host;

function fakeFetch(failArchiveFor: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const host = url.hostname;
    if (url.pathname === "/feed") {
      if (host === CITRINI) return new Response(rss(host, [{ slug: "boot", title: "Why BOOT is cheap", text: "Boot Barn Holdings shows $MNRO too", category: "Retail" }, { slug: "macro", title: "Macro" }]));
      if (host === AURELION) return new Response(rss(host, [{ slug: "one", title: "One" }]));
      return new Response(rss(host, []));
    }
    if (url.pathname === "/api/v1/archive") {
      if (failArchiveFor.includes(host)) return new Response("blocked", { status: 403 });
      if (host === CITRINI) return Response.json(archive(host, [{ slug: "boot", title: "Why BOOT is cheap", audience: "only_paid", tags: ["retail", "Consumer"] }]));
      return Response.json([]);
    }
    // A *.substack.com publication read through a gateway (a publication's own domain).
    if (url.pathname.startsWith("/api/v1/user/")) {
      if (failArchiveFor.includes("gateways")) return new Response("Just a moment...", { status: 403 });
      return Response.json({ id: 42, handle: url.pathname.split("/")[4] });
    }
    if (url.pathname === "/api/v1/profile/posts") {
      return Response.json({
        posts: [
          ...archive("analysisparalysis888.substack.com", [{ slug: "own", title: "Up 45% YTD", audience: "everyone" }]),
          ...archive("other.substack.com", [{ slug: "elsewhere", title: "Guest post elsewhere", audience: "everyone" }]),
        ].map((p) => ({ ...p, truncated_body_text: "Boot Barn is my long, in my view." })),
      });
    }
    if (host === "dualityfund.com") return new Response("<html><body><h1>Duality</h1><p>We manage a global long/short equity portfolio.</p></body></html>");
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  complete = categorize();
  await db.insert(gold.tickers).values({ symbol: "BOOT", market: "US", aliases: [], inPortfolio: false, position: "watch" });
  await db.insert(gold.companyProfiles).values({ symbol: "BOOT", name: "Boot Barn Holdings, Inc.", provenance: {} });
});
afterEach(async () => close());

// Claude filing Thierry's own articles on the research portal: "Up 45% YTD" is a performance memo.
const categorize = () =>
  vi.fn(async () => ({ text: JSON.stringify({ verdict: "memo", probability: 0.9, cited_sentence: null, reason: "A performance update." }), model: "test" }));
let complete = categorize();
const ctx = (failArchiveFor: string[] = []): SourceContext => ({ env: {}, fetch: fakeFetch(failArchiveFor), complete });

describe("content-posts dimension", () => {
  it("lands every feed in bronze, dedups a post both sources list into ONE row carrying both tags", async () => {
    const report = await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("succeeded");
    // Each reference feed and Thierry's own (seeded), by two sources.
    expect(await db.select().from(fetches).where(eq(fetches.dimension, "content-posts"))).toHaveLength(REFERENCE_PUBLICATIONS.length * 2 - REFERENCE_PUBLICATIONS.filter((p) => p.host.endsWith(".substack.com")).length);

    const posts = await db.select().from(content.contentPosts);
    expect(posts).toHaveLength(3);
    const boot = posts.find((p) => p.title === "Why BOOT is cheap")!;
    expect(boot.sources.sort()).toEqual(["substack-archive", "substack-rss"]);
    expect(boot.bronzeIds).toHaveLength(2);
    // The archive gives the audience and word count, RSS does not; tags are the union, case-insensitive.
    expect(boot.audience).toBe("only_paid");
    expect(boot.wordCount).toBe(1200);
    expect(boot.topics.map((x) => x.toLowerCase()).sort()).toEqual(["consumer", "retail"]);
    expect(boot.tickers).toEqual(["BOOT", "MNRO"]);
    expect(posts.find((p) => p.title === "Macro")!.sources).toEqual(["substack-rss"]);

    const library = await db.select().from(content.goldContentLibrary);
    expect(library).toHaveLength(3);
    expect(library.find((p) => p.id === boot.id)?.publicationName).toBe("Citrini Research");
  });

  it("a second run updates rows in place: no duplicate post, the source's bronze id moves to the new answer", async () => {
    await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    const before = (await db.select().from(content.contentPosts)).find((p) => p.title === "Why BOOT is cheap")!;
    await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    const after = await db.select().from(content.contentPosts);
    expect(after).toHaveLength(3);
    const boot = after.find((p) => p.id === before.id)!;
    expect(boot.sources).toHaveLength(2);
    expect(boot.bronzeIds.some((id) => before.bronzeIds.includes(id))).toBe(false);
  });

  it("a failed source keeps the other's posts and shows on the publication's health", async () => {
    const report = await runDimension(db, contentPosts, { trigger: "test", ctx: ctx([CITRINI]) });
    expect(report.status).toBe("partial");
    const boot = (await db.select().from(content.contentPosts)).find((p) => p.title === "Why BOOT is cheap")!;
    expect(boot.sources).toEqual(["substack-rss"]);
    const [pub] = await db.select().from(content.goldContentPublications).where(eq(content.goldContentPublications.host, CITRINI));
    expect(pub.sourceHealth["substack-archive"].status).toBe("failed");
    expect(pub.sourceHealth["substack-rss"].status).toBe("ok");
    expect(pub.posts).toBe(2);
  });

  it("reads every Substack account we write for (the accounts file), tagged as ours, with a voice excerpt", async () => {
    await runDimension(db, contentAccounts, { trigger: "test", ctx: { env: { REPO_ROOT }, fetch: fakeFetch() } });
    const [channel] = await db.select().from(content.goldContentChannels).where(eq(content.goldContentChannels.kind, "substack"));
    expect(channel.url).toBe("https://analysisparalysis888.substack.com");
    await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    const pubs = await db.select().from(content.goldContentPublications);
    expect(pubs.find((p) => p.host === "analysisparalysis888.substack.com")?.kind).toBe("own");
    const boot = (await db.select().from(content.contentPosts)).find((p) => p.title === "Why BOOT is cheap")!;
    expect(boot.excerpt).toContain("Boot Barn");
    // Thierry's own *.substack.com: read through a gateway, only his publication's posts kept, RSS not tried.
    const own = (await db.select().from(content.contentPosts)).filter((p) => p.publicationHost === "analysisparalysis888.substack.com");
    expect(own.map((p) => p.title)).toEqual(["Up 45% YTD"]);
    expect(own[0].sources).toEqual(["substack-archive"]);
    const ownFetches = (await db.select().from(fetches)).filter((f) => f.subject === "analysisparalysis888.substack.com");
    expect(ownFetches.map((f) => f.source)).toEqual(["substack-archive"]);
    expect(String((ownFetches[0].request as { url: string }).url)).not.toContain("substack.com/api");
    // Each own article is filed ONCE on the research portal (reference posts never judged), the verdict in gold.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(complete.mock.calls[0])).toContain("Title: Up 45% YTD");
    const library = await db.select().from(content.goldContentLibrary);
    expect(library.find((p) => p.title === "Up 45% YTD")?.researchCategory).toBe("memo");
    expect(library.find((p) => p.title === "Why BOOT is cheap")?.researchCategory).toBeNull();
    await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    expect(complete).toHaveBeenCalledTimes(1);

    await addAccount(db, { channel: "substack", owner: "dualis", name: "Dualis", address: "dualis.substack.com/" }, "user_1");
    await runDimension(db, contentPosts, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(content.goldContentPublications)).find((p) => p.host === "dualis.substack.com")?.kind).toBe("own");
    // The site links to the Dualis account once it exists.
    const [site] = await db.select().from(content.goldContentChannels).where(eq(content.goldContentChannels.kind, "substack"));
    expect(site.url).toBe("https://dualis.substack.com");
  });
});

describe("parsers", () => {
  it("urlKey ignores scheme, www, query, fragment and trailing slash", () => {
    expect(urlKey("https://www.citriniresearch.com/p/boot/?utm=x#a")).toBe(urlKey("http://citriniresearch.com/p/boot"));
  });
  it("parseRss reads CDATA, entities and categories", () => {
    const { meta, posts } = parseRss(rss("a.com", [{ slug: "x", title: "T &amp; Co", category: "Japan" }]));
    expect(meta.name).toBe("Feed of a.com");
    expect(posts[0]).toMatchObject({ title: "T & Co", subtitle: "Sub & title", author: "Author A", topics: ["Japan"] });
  });
  it("parseArchive refuses a non-list answer", () => {
    expect(() => parseArchive({ error: "x" })).toThrow(/not a list/);
  });
  it("matches symbols case-sensitively, names case-insensitively, and every $cashtag", () => {
    const w = [{ symbol: "BOOT", name: "Boot Barn Holdings, Inc.", aliases: [] }, { symbol: "4238.T", name: "Miraial Co., Ltd.", aliases: ["Miraial"] }];
    expect(shortName("Boot Barn Holdings, Inc.")).toBe("Boot Barn");
    expect(mentionedTickers("we bought new boots", w)).toEqual([]);
    expect(mentionedTickers("boot barn and Miraial, plus $TSLA", w)).toEqual(["4238.T", "BOOT", "TSLA"]);
    expect(mentionedTickers("enterprise software and the Enterprise AI wave", [{ symbol: "E.TO", name: "Enterprise Group, Inc.", aliases: [] }])).toEqual([]);
    expect(shortName("Enterprise Group, Inc.")).toBe("Enterprise Group");
  });
});
