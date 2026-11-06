import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as content from "@/db/schema/content";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import type { SourceContext } from "../../types";
import { coverPhotos, creditLine, displayUrl, openverseUrl, parseQueries } from ".";

const OWN = "analysisparalysis888.substack.com";
const WAFER = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Silicon_wafer.jpg";

const result = (id: string, title: string, url: string, width = 4000) => ({
  id,
  title,
  url,
  width,
  height: 2600,
  creator: "<a href='x'>Jane Doe</a>",
  license: "by-sa",
  license_version: "4.0",
  foreign_landing_url: `https://commons.wikimedia.org/w/index.php?curid=${id}`,
  source: "wikimedia",
});

function fakeFetch(calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("q") ?? "");
    if (url.hostname !== "api.openverse.org") throw new Error(`unexpected ${url}`);
    return Response.json({
      results: [result("w1", "File:Silicon wafer.jpg", WAFER), result("c1", "Chart of wafer demand", "https://upload.wikimedia.org/wikipedia/commons/1/12/Chart.jpg"), result("x1", "Flickr copy", "https://live.staticflickr.com/1.jpg")],
    });
  }) as typeof fetch;
}

/** Search terms first, then the pick (judge) answer naming the wafer photo. */
const fakeComplete: Complete = async ({ prompt }) =>
  prompt.startsWith("Question:")
    ? { text: JSON.stringify({ verdict: "w1", probability: 0.9, cited_sentence: null, reason: "The wafer shows the industry." }), model: "fake" }
    : { text: '{"queries": ["silicon wafer", "wafer carrier"]}', model: "fake" };

describe("cover-photos", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await testDb());
    await db.insert(content.contentPublications).values({ host: OWN, name: "Analysis Paralysis", kind: "own", sources: ["substack-rss"], bronzeIds: [] });
    await db.insert(content.contentPublications).values({ host: "read.aurelionresearch.com", name: "Aurelion", kind: "reference", sources: ["substack-rss"], bronzeIds: [] });
    const base = { format: "substack-article" as const, topics: [], tickers: ["4238.T"], tickersBySource: {}, sources: ["substack-archive"], bronzeIds: [] };
    await db.insert(content.contentPosts).values([
      { ...base, urlKey: "own/semi", url: `https://${OWN}/p/semi`, title: "Semi stock that benefits from wafer demand", publicationHost: OWN },
      { ...base, urlKey: "ref/one", url: "https://read.aurelionresearch.com/p/one", title: "One", publicationHost: "read.aurelionresearch.com" },
    ]);
  });
  afterEach(async () => close());

  const ctx = (calls: string[]): SourceContext => ({ env: {}, fetch: fakeFetch(calls), db, complete: fakeComplete });

  it("picks one Commons photo per own article, once, and serves it in gold with its credit", async () => {
    const calls: string[] = [];
    const report = await runDimension(db, coverPhotos, { trigger: "test", ctx: ctx(calls) });
    expect(report.status).toBe("succeeded");
    expect(calls).toEqual(["silicon wafer", "wafer carrier"]);
    const [own] = await db.select().from(content.goldContentLibrary).where(eq(content.goldContentLibrary.publicationHost, OWN));
    expect(own.coverPhotoUrl).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Silicon_wafer.jpg/1280px-Silicon_wafer.jpg");
    expect(own.coverPhotoCredit).toBe("Photo: Jane Doe, CC BY-SA 4.0");
    expect(own.coverPhotoLink).toBe("https://commons.wikimedia.org/w/index.php?curid=w1");
    const [ref] = await db.select().from(content.goldContentLibrary).where(eq(content.goldContentLibrary.publicationHost, "read.aurelionresearch.com"));
    expect(ref.coverPhotoUrl).toBeNull();
    // The pick only offered Commons files (the Flickr result is dropped).
    const [pick] = await db.select().from(judgments).where(eq(judgments.questionKey, "cover-photo@v1"));
    expect(pick.verdict).toBe("w1");

    // Second run: nothing left to fetch.
    const again: string[] = [];
    await runDimension(db, coverPhotos, { trigger: "test", ctx: ctx(again) });
    expect(again).toEqual([]);
  });

  it("builds the Openverse search, the display size and the credit", () => {
    const u = new URL(openverseUrl("gold bars"));
    expect(u.searchParams.get("source")).toBe("wikimedia");
    expect(u.searchParams.get("license_type")).toBe("commercial");
    expect(displayUrl({ url: WAFER, width: 900 })).toBe(WAFER);
    expect(creditLine({ creator: null, license: "cc0", licenseVersion: "1.0" })).toBe("Photo: Wikimedia Commons, CC0");
    expect(parseQueries('Sure: {"queries": ["gold bars", " ", "gold mine", "vault", "extra"]}')).toEqual(["gold bars", "gold mine", "vault"]);
    expect(() => parseQueries('{"queries": []}')).toThrow(/no search terms/);
  });
});
