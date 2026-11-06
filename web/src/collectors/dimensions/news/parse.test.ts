import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  cleanCompanyName,
  googleQueries,
  mergeArticles,
  parseRss,
  type RawArticle,
  stripPublisherSuffix,
  titleKey,
} from "./parse";

const article = (over: Partial<RawArticle>): RawArticle => ({
  source: "yahoo",
  bronzeId: "b-yahoo",
  symbol: "MNRO",
  matchKind: "symbol",
  matchedTerm: "MNRO",
  title: "Monro reports second quarter results",
  url: "https://finance.yahoo.com/news/monro-q2.html",
  publisher: null,
  summary: null,
  imageUrl: null,
  publishedAt: new Date("2026-11-03T12:00:00Z"),
  ...over,
});

describe("query terms", () => {
  it("cleans legal suffixes but keeps descriptive words", () => {
    expect(cleanCompanyName("Monro, Inc.")).toBe("Monro");
    expect(cleanCompanyName("ADF Group Inc.")).toBe("ADF Group");
    expect(cleanCompanyName("Capstone Energy Plus, Inc. Common Stock")).toBe("Capstone Energy Plus");
    expect(cleanCompanyName("Musashi Seimitsu Industry Co., Ltd.")).toBe("Musashi Seimitsu Industry");
  });

  it("queries the name then each alias; a one-word alias is ANDed with the ticker", () => {
    expect(googleQueries("CNRD", "Conrad Industries, Inc.", ["Conrad Shipyard", "Conrad Industries", "Conrad"])).toEqual([
      { kind: "name", term: "Conrad Industries", q: '"Conrad Industries" when:7d' },
      { kind: "alias", term: "Conrad Shipyard", q: '"Conrad Shipyard" when:7d' },
      { kind: "alias", term: "Conrad", q: '"Conrad" CNRD when:7d' },
    ]);
    expect(googleQueries("4238.T", "Miraial", ["Mira"])[1].q).toBe('"Mira" 4238 when:7d');
  });
});

describe("RSS", () => {
  it("reads items, CDATA and entities", () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>A &amp; B - Reuters</title><link>https://x.com/a</link>
      <pubDate>Tue, 03 Nov 2026 03:25:36 +0000</pubDate><description><![CDATA[<b>Hi</b>]]></description>
      <source url="https://reuters.com">Reuters</source></item><item><title>no link</title></item></channel></rss>`;
    expect(parseRss(xml)).toEqual([
      { title: "A & B - Reuters", link: "https://x.com/a", pubDate: "Tue, 03 Nov 2026 03:25:36 +0000", description: "<b>Hi</b>", source: "Reuters" },
    ]);
  });

  it("an answer that is not RSS throws instead of reading as no news", () => {
    expect(() => parseRss("<html>captcha</html>")).toThrow(/not an RSS feed/);
    expect(parseRss("<rss><channel></channel></rss>")).toEqual([]);
  });

  it("drops the Google News publisher suffix", () => {
    expect(stripPublisherSuffix("Monro beats - Reuters", "Reuters")).toBe("Monro beats");
    expect(stripPublisherSuffix("A - B", null)).toBe("A - B");
    expect(stripPublisherSuffix("Fund sells $5 million in Playboy shares By Investing.com - Investing.com Australia", "Investing.com Australia")).toBe(
      "Fund sells $5 million in Playboy shares",
    );
    expect(stripPublisherSuffix("Stand by me", null)).toBe("Stand by me");
  });
});

describe("canonical keys", () => {
  it("ignores scheme, www, tracking params, fragment and trailing slash", () => {
    expect(canonicalUrl("https://www.a.com/x/?utm_source=rss&id=2#top")).toBe("a.com/x?id=2");
    expect(canonicalUrl("http://a.com/x?.tsrc=rss")).toBe(canonicalUrl("https://a.com/x"));
  });

  it("near-identical titles share a key", () => {
    expect(titleKey("Monro, Inc. Reports Q2  Results!")).toBe(titleKey("monro inc reports q2 results"));
  });
});

describe("mergeArticles (dedup + multi-source tags)", () => {
  it("one article seen by three sources is ONE item carrying every source", () => {
    const { items, mentions } = mergeArticles([], [
      article({ source: "finnhub", bronzeId: "b-fh", url: "https://finnhub.io/api/news?id=1", summary: "Short." }),
      article({ source: "google-news", bronzeId: "b-g", url: "https://news.google.com/rss/articles/X", matchKind: "name", matchedTerm: "Monro", publisher: "Reuters" }),
      article({ source: "yahoo", bronzeId: "b-y", url: "https://finance.yahoo.com/news/monro-q2.html?.tsrc=rss", summary: "A longer summary." }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].sources).toEqual(["finnhub", "google-news", "yahoo"]);
    expect(items[0].bronzeIds).toEqual(["b-fh", "b-g", "b-y"]);
    expect(items[0].url).toBe("https://finance.yahoo.com/news/monro-q2.html?.tsrc=rss");
    expect(items[0].publisher).toBe("Reuters");
    expect(items[0].summary).toBe("A longer summary.");
    expect(items[0].urls).toHaveLength(3);
    // How it matched: by symbol (finnhub + yahoo) and by name (google).
    expect(mentions.map((m) => [m.matchKind, m.matchedTerm, m.sources])).toEqual([
      ["symbol", "MNRO", ["finnhub", "yahoo"]],
      ["name", "Monro", ["google-news"]],
    ]);
  });

  it("same link, different title = same article", () => {
    const { items } = mergeArticles([], [
      article({ title: "Monro Q2" }),
      article({ source: "finnhub", title: "Monro second quarter", url: "https://www.finance.yahoo.com/news/monro-q2.html/" }),
    ]);
    expect(items).toHaveLength(1);
  });

  it("the same title weeks apart is two stories", () => {
    const { items } = mergeArticles([], [
      article({ title: "Monro announces quarterly dividend payment", url: "https://a.com/1" }),
      article({ title: "Monro announces quarterly dividend payment", url: "https://a.com/2", publishedAt: new Date("2026-08-01T00:00:00Z") }),
    ]);
    expect(items).toHaveLength(2);
  });

  it("an existing item is matched, not duplicated, and its earliest date kept", () => {
    const first = mergeArticles([], [article({})]).items;
    first[0].id = "item-1";
    first[0].touched = false;
    const { items } = mergeArticles(first, [article({ source: "finnhub", url: "https://finnhub.io/api/news?id=9", publishedAt: new Date("2026-11-03T10:00:00Z") })]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("item-1");
    expect(items[0].touched).toBe(true);
    expect(items[0].publishedAt?.toISOString()).toBe("2026-11-03T10:00:00.000Z");
  });
});
