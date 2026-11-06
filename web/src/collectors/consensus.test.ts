import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consensus, consensusCoverage } from "@/db/schema/consensus";
import { fetches } from "@/db/schema/bronze";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { consensusDim } from "./dimensions/consensus";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const raw = (v: number) => ({ raw: v });
const est = (avg: number, low: number, high: number, n: number) => ({ avg: raw(avg), low: raw(low), high: raw(high), numberOfAnalysts: raw(n) });
/** Yahoo pads periods nobody covers with zeros and no analysts: never a consensus. */
const NO_EST = { avg: raw(0), low: raw(0), high: raw(0), numberOfAnalysts: raw(0) };

const summary = (symbol: string) => {
  if (symbol === "MNRO") {
    return {
      earningsTrend: {
        trend: [
          { period: "0q", endDate: "2026-12-31", earningsEstimate: { ...est(0.01, -0.06, 0.09, 4), earningsCurrency: "USD" }, revenueEstimate: { ...est(291808000, 288986000, 297494000, 5), revenueCurrency: "USD" } },
          { period: "+1q", endDate: "2027-03-31", earningsEstimate: { ...est(-0.255, -0.35, -0.17, 4), earningsCurrency: "USD" }, revenueEstimate: NO_EST },
          { period: "0y", endDate: "2027-03-31", earningsEstimate: { ...est(-0.3375, -0.45, -0.2, 4), earningsCurrency: "USD" }, revenueEstimate: NO_EST },
          { period: "+5y", endDate: null, earningsEstimate: {}, revenueEstimate: {} },
        ],
      },
      earningsHistory: { history: [{ quarter: { raw: 1790726400, fmt: "2026-09-30" }, epsActual: raw(-0.01), epsEstimate: raw(0.05), currency: "USD", period: "-1q" }] },
    };
  }
  return { earningsTrend: { trend: [{ period: "0q", endDate: null, earningsEstimate: NO_EST, revenueEstimate: NO_EST }] }, earningsHistory: { history: [] } };
};

let crumbCalls = 0;
const fake = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const path = url.pathname;
  if (url.host === "fc.yahoo.com") return new Response("", { status: 404 });
  if (path === "/v1/test/getcrumb") {
    crumbCalls++;
    return new Response("crumb123", { status: 200 });
  }
  if (path.startsWith("/v10/finance/quoteSummary/")) {
    if (url.searchParams.get("crumb") !== "crumb123") return new Response("Invalid Crumb", { status: 401 });
    return json({ quoteSummary: { result: [summary(decodeURIComponent(path.split("/").pop()!))], error: null } });
  }
  if (path.startsWith("/ws/fundamentals-timeseries/")) {
    if (!path.endsWith("/MNRO")) return json({ timeseries: { result: [] } });
    const pt = (t: string, date: string, v: number) => ({ meta: { symbol: ["MNRO"], type: [t] }, [t]: [{ asOfDate: date, currencyCode: "USD", reportedValue: { raw: v } }] });
    return json({ timeseries: { result: [pt("quarterlyTotalRevenue", "2026-09-30", 283638000), pt("quarterlyEBITDA", "2026-09-30", 17859000), pt("quarterlyDilutedEPS", "2026-09-30", -0.051425), pt("annualNetIncome", "2026-03-31", 1000000)] } });
  }
  if (url.host === "api.nasdaq.com") {
    if (!path.includes("/MNRO/")) return json({ data: null });
    return json({ data: {
      quarterlyForecast: { rows: [
        { fiscalEnd: "Dec 2026", consensusEPSForecast: 0.17, highEPSForecast: 0.17, lowEPSForecast: 0.17, noOfEstimates: 1 },
        { fiscalEnd: "Mar 2027", consensusEPSForecast: -0.255, highEPSForecast: -0.17, lowEPSForecast: -0.35, noOfEstimates: 4 },
      ] },
      yearlyForecast: { rows: [{ fiscalEnd: "Mar 2027", consensusEPSForecast: "-0.34", highEPSForecast: -0.2, lowEPSForecast: -0.45, noOfEstimates: 1 }] },
    } });
  }
  if (url.host === "finnhub.io") {
    if (url.searchParams.get("symbol") !== "MNRO") return json(path.endsWith("/stock/earnings") ? [] : { earningsCalendar: [] });
    if (path.endsWith("/calendar/earnings")) {
      return json({ earningsCalendar: [
        { symbol: "MNRO", date: "2026-10-29", hour: "bmo", year: 2027, quarter: 2, epsEstimate: 0.05, epsActual: -0.01, revenueEstimate: 289818924, revenueActual: 283638000 },
        { symbol: "MNRO", date: "2027-01-28", hour: "bmo", year: 2027, quarter: 3, epsEstimate: 0.12, epsActual: null, revenueEstimate: 300e6, revenueActual: null },
      ] });
    }
    return json([{ period: "2026-09-30", year: 2027, quarter: 2, estimate: 0.05, actual: -0.01 }]);
  }
  if (url.host === "m.stock.naver.com") {
    if (!path.includes("/101160/")) return new Response("not found", { status: 404 });
    const cols = (keys: [string, string][]) => keys.map(([key, c]) => ({ key, isConsensus: c, title: key }));
    if (path.endsWith("/annual")) {
      return json({ financeInfo: {
        trTitleList: cols([["202512", "N"], ["202612", "Y"]]),
        rowList: [
          { title: "매출액", columns: { "202512": { value: "2,918" }, "202612": { value: "3,000" } } },
          { title: "영업이익", columns: { "202512": { value: "585" }, "202612": { value: "-" } } },
          { title: "EPS", columns: { "202512": { value: "2,482" }, "202612": { value: "2,600" } } },
          { title: "ROE", columns: { "202512": { value: "12.53" }, "202612": { value: "13" } } },
        ],
      } });
    }
    return json({ financeInfo: { trTitleList: cols([["202609", "Y"]]), rowList: [{ title: "매출액", columns: { "202609": { value: "-" } } }] } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const ctx = (): SourceContext => ({ env: { REPO_ROOT, FINNHUB_API_KEY: "k" }, fetch: fake });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  crumbCalls = 0;
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await analyseEveryTicker(db);
});
afterEach(async () => close());

const row = async (symbol: string, periodType: string, periodEnd: string, metric: string) =>
  (await db.select().from(consensus).where(and(eq(consensus.symbol, symbol), eq(consensus.periodType, periodType as "quarter"), eq(consensus.periodEnd, periodEnd), eq(consensus.metric, metric))))[0];

describe("consensus dimension", () => {
  it("keeps the range of the source with the most analysts, never mixed, and lists every source that agrees", async () => {
    await runDimension(db, consensusDim, { trigger: "test", ctx: ctx() });
    // Next quarter: Yahoo (4 analysts) beats Nasdaq (1) and Finnhub (mean only); their means are alternatives.
    expect(await row("MNRO", "quarter", "2026-12", "eps")).toMatchObject({ low: -0.06, mean: 0.01, high: 0.09, analysts: 4, actual: null, currency: "USD" });
    expect((await row("MNRO", "quarter", "2026-12", "eps")).provenance.mean).toEqual({ sources: ["yahoo"], alternatives: 2 });
    // Same range from Yahoo and Nasdaq: one value, both tags.
    const mar = await row("MNRO", "quarter", "2027-03", "eps");
    expect(mar).toMatchObject({ low: -0.35, mean: -0.255, high: -0.17, analysts: 4 });
    expect(mar.provenance.mean.sources.sort()).toEqual(["nasdaq", "yahoo"]);
    // A period Yahoo pads with zero analysts is not a consensus.
    expect(await row("MNRO", "quarter", "2027-03", "revenue")).toBeUndefined();
    expect(await row("MNRO", "year", "2027-03", "eps")).toMatchObject({ mean: -0.3375, analysts: 4 });
  });

  it("puts the reported actual beside the consensus, street EPS over GAAP, every agreeing source tagged", async () => {
    await runDimension(db, consensusDim, { trigger: "test", ctx: ctx() });
    const eps = await row("MNRO", "quarter", "2026-09", "eps");
    expect(eps).toMatchObject({ mean: 0.05, actual: -0.01 });
    expect(eps.provenance.actual).toEqual({ sources: expect.arrayContaining(["yahoo", "finnhub"]), alternatives: 1 });
    const revenue = await row("MNRO", "quarter", "2026-09", "revenue");
    expect(revenue).toMatchObject({ mean: 289818924, actual: 283638000 });
    expect(revenue.provenance.actual.sources.sort()).toEqual(["finnhub", "yahoo-fundamentals"]);
    // EBITDA: actual only, no free consensus.
    expect(await row("MNRO", "quarter", "2026-09", "ebitda")).toMatchObject({ mean: null, low: null, analysts: null, actual: 17859000 });
    expect(await row("MNRO", "year", "2026-03", "net-income")).toMatchObject({ actual: 1000000 });
    // One silver fact per stat of (ticker, period, metric).
    const f = await db.select().from(facts).where(and(eq(facts.dimension, "consensus"), eq(facts.subject, "MNRO|quarter|2026-09|revenue"), eq(facts.field, "actual")));
    expect(f).toHaveLength(1);
  });

  it("reads Korean consensus from Naver in won, and one Yahoo crumb serves the whole run", async () => {
    await runDimension(db, consensusDim, { trigger: "test", ctx: ctx() });
    expect(await row("101160.KQ", "year", "2026-12", "revenue")).toMatchObject({ mean: 3000e8, actual: null, currency: "KRW" });
    expect(await row("101160.KQ", "year", "2025-12", "operating-income")).toMatchObject({ actual: 585e8, mean: null });
    expect(await row("101160.KQ", "year", "2026-12", "eps")).toMatchObject({ mean: 2600 });
    expect(crumbCalls).toBe(1);
    const yahooRows = await db.select().from(fetches).where(eq(fetches.source, "yahoo"));
    expect(JSON.stringify(yahooRows.map((r) => r.request))).not.toContain("crumb123");
  });

  it("says per ticker and source who has a consensus, who only actuals, who does not cover the market", async () => {
    const report = await runDimension(db, consensusDim, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("partial"); // Naver 404s on two Korean tickers.
    const cov = await db.select().from(consensusCoverage);
    const at = (source: string, symbol: string) => cov.find((c) => c.source === source && c.symbol === symbol);
    expect(at("yahoo", "MNRO")).toMatchObject({ status: "estimates", market: "US" });
    expect(at("yahoo-fundamentals", "MNRO")).toMatchObject({ status: "actuals" });
    expect(at("yahoo", "4238.T")).toMatchObject({ status: "empty" });
    expect(at("nasdaq", "4238.T")).toMatchObject({ status: "not_covered" });
    expect(at("nasdaq", "LESL")).toMatchObject({ status: "empty" });
    expect(at("naver", "101160.KQ")).toMatchObject({ status: "estimates" });
    expect(at("naver", "267290.KS")).toMatchObject({ status: "failed" });
  });
});
