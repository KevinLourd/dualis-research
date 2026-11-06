import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { companyProfiles, tickers as goldTickers } from "@/db/schema/gold";
import { runSources, runs } from "@/db/schema/ops";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { companyProfile as fullProfile } from "./dimensions/company-profile";
import { finnhub, fmp, yahoo } from "./dimensions/company-profile/sources";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const env = { REPO_ROOT, FMP_API_KEY: "fmp-secret", FINNHUB_API_KEY: "fh-secret" };

/** Fake vendors: US symbols answer on FMP/Finnhub, every symbol on Yahoo. */
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const symbol = url.searchParams.get("symbol") ?? decodeURIComponent(url.pathname.split("/").pop()!);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.host.includes("financialmodelingprep")) {
    if (symbol !== "MNRO") return json([]);
    return json([{ companyName: "Monro, Inc.", exchange: "NASDAQ", currency: "USD", marketCap: 364e6, fullTimeEmployees: "7000", website: "https://www.monro.com" }]);
  }
  if (url.host.includes("finnhub")) {
    if (symbol !== "MNRO") return json({});
    return json({ name: "Monro Inc", exchange: "NASDAQ NMS - GLOBAL MARKET", currency: "USD", marketCapitalization: 364.3, weburl: "https://www.monro.com/" });
  }
  if (url.host.includes("yahoo")) {
    if (symbol === "LESL") return json({ chart: { error: "rate limited" } }, 429);
    const longName = symbol === "4238.T" ? "Miraial Co., Ltd." : symbol === "MNRO" ? "Monro, Inc." : `${symbol} Corp`;
    return json({ chart: { result: [{ meta: { longName, fullExchangeName: "Somewhere", currency: "USD" } }] } });
  }
  throw new Error(`unexpected url ${url}`);
}) as typeof fetch;

const ctx: SourceContext = { env, fetch: fakeFetch };

/** The worked example runs on its first three sources; the other sources have their own tests (market-data.test.ts). */
const companyProfile = { ...fullProfile, sources: [fmp, finnhub, yahoo] };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

describe("watchlist dimension", () => {
  it("lands the file in bronze, promotes 37 tickers to silver and gold", async () => {
    const report = await runDimension(db, watchlist, { trigger: "test", ctx });
    expect(report.status).toBe("succeeded");
    expect(await db.select().from(fetches)).toHaveLength(1);
    const gold = await db.select().from(goldTickers);
    expect(gold).toHaveLength(37);
    expect(gold.find((t) => t.symbol === "MNRO")?.thesisNote).toContain("Icahn");
    expect(gold.filter((t) => t.inPortfolio).map((t) => t.symbol).sort()).toEqual(["101160.KQ", "1161.HK", "4238.T", "SPCB"]);
  });
});

describe("company-profile dimension (worked example)", () => {
  beforeEach(async () => {
    await runDimension(db, watchlist, { trigger: "test", ctx });
  });

  it("writes bronze for every covered fetch, without secrets", async () => {
    const report = await runDimension(db, companyProfile, { trigger: "test", ctx });
    const rows = await db.select().from(fetches).where(eq(fetches.dimension, "company-profile"));
    const usCount = report.sources.find((s) => s.source === "fmp")!.requested;
    expect(rows).toHaveLength(usCount * 2 + 37);
    expect(JSON.stringify(rows.map((r) => r.request))).not.toMatch(/secret/);
  });

  it("one fact carries every agreeing source; gold picks it and lists them", async () => {
    await runDimension(db, companyProfile, { trigger: "test", ctx });
    const nameFacts = await db
      .select()
      .from(facts)
      .where(and(eq(facts.subject, "MNRO"), eq(facts.field, "name")));
    expect(nameFacts).toHaveLength(1);
    expect(nameFacts[0].sources.sort()).toEqual(["finnhub", "fmp", "yahoo"]);

    const [mnro] = await db.select().from(companyProfiles).where(eq(companyProfiles.symbol, "MNRO"));
    expect(mnro.name).toBe("Monro, Inc.");
    expect(mnro.provenance.name.sources.sort()).toEqual(["finnhub", "fmp", "yahoo"]);
    expect(mnro.provenance.exchange).toEqual({ sources: ["fmp"], alternatives: 2 });
    expect(mnro.employees).toBe(7000);
    expect(mnro.website).toBe("https://www.monro.com");
  });

  it("Thierry's watchlist name wins and is tagged with the sources that agree", async () => {
    await runDimension(db, companyProfile, { trigger: "test", ctx });
    const [miraial] = await db.select().from(companyProfiles).where(eq(companyProfiles.symbol, "4238.T"));
    expect(miraial.name).toBe("Miraial Co Ltd");
    // Yahoo's "Miraial Co., Ltd." normalizes to the same key: one fact, two tags.
    expect(miraial.provenance.name).toEqual({ sources: ["watchlist", "yahoo"], alternatives: 0 });
  });

  it("records per-source status, counts and errors", async () => {
    const report = await runDimension(db, companyProfile, { trigger: "test", ctx });
    expect(report.status).toBe("partial");
    const rows = await db.select().from(runSources).where(eq(runSources.runId, report.runId));
    const fmp = rows.find((r) => r.source === "fmp")!;
    expect(fmp.skipped).toBeGreaterThan(0); // non-US symbols are not asked
    expect(fmp.succeeded).toBe(1);
    expect(fmp.status).toBe("partial"); // other US symbols got an empty answer
    const yahoo = rows.find((r) => r.source === "yahoo")!;
    expect(yahoo.failed).toBe(1);
    expect(yahoo.errors[0]).toMatchObject({ subject: "LESL" });
    const [run] = await db.select().from(runs).where(eq(runs.id, report.runId));
    expect(run.finishedAt).not.toBeNull();
  });

  it("a missing key fails that source by name and leaves the others running", async () => {
    const report = await runDimension(db, companyProfile, { trigger: "test", ctx: { env: { REPO_ROOT }, fetch: fakeFetch } });
    const fmp = report.sources.find((s) => s.source === "fmp")!;
    expect(fmp.status).toBe("failed");
    expect(fmp.errors[0].message).toBe("missing env: FMP_API_KEY");
    expect(report.sources.find((s) => s.source === "yahoo")!.succeeded).toBe(36);
  });

  it("a second run moves a source to its new answer", async () => {
    await runDimension(db, companyProfile, { trigger: "test", ctx });
    const renamed = (async (input: string | URL | Request) => {
      const res = await fakeFetch(input);
      if (!String(input).includes("yahoo") || !String(input).includes("MNRO")) return res;
      return new Response(JSON.stringify({ chart: { result: [{ meta: { longName: "Monro Holdings" } }] } }));
    }) as typeof fetch;
    await runDimension(db, companyProfile, { trigger: "test", ctx: { env, fetch: renamed } });
    const nameFacts = await db.select().from(facts).where(and(eq(facts.subject, "MNRO"), eq(facts.field, "name")));
    expect(nameFacts.map((f) => [f.value, [...f.sources].sort()]).sort()).toEqual([
      ["Monro Holdings", ["yahoo"]],
      ["Monro, Inc.", ["finnhub", "fmp"]],
    ]);
  });

  it("a promotion crash marks the run failed with its error", async () => {
    const broken = { ...companyProfile, promote: async () => Promise.reject(new Error("boom")) };
    const report = await runDimension(db, broken, { trigger: "test", ctx });
    expect(report.status).toBe("failed");
    const [run] = await db.select().from(runs).where(eq(runs.id, report.runId));
    expect(run.error).toContain("boom");
  });
});
