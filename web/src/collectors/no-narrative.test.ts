import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fairValueHistory, fairValues, narratives } from "@/db/schema/analysis";
import { fetches as bronze } from "@/db/schema/bronze";
import { financialMetrics, goldFinancialLines, valuations } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import { valuationSyntheses } from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { analysis, analysisSubjects, comparablePrice, currentSides } from "./dimensions/analysis";
import { gatherFacts } from "./dimensions/analysis/facts";
import { deriveMetrics } from "./dimensions/financials/derive";
import { fxDim, neededPairs, rateOn } from "./dimensions/fx";
import { marketReactionDim } from "./dimensions/market-reaction";
import { rebuildValuationGold } from "./dimensions/valuation";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

/** NO-NARRATIVE-1110: every ticker in the analysis scope gets its theses, or a failed fetch saying why. */
const REPO_ROOT = resolve(__dirname, "../../..");
const OBE = "OBE";
const DAY = 86_400;

/** Yahoo chart for CADUSD=X: 1 CAD = 0.72 USD on the last day, 0.70 before. */
const yahooFx = (url: string) => {
  if (!url.includes("CADUSD%3DX")) return new Response("{}", { status: 404 });
  const t0 = Date.UTC(2026, 10, 5) / 1000;
  return Response.json({ chart: { result: [{ meta: { currency: "USD", gmtoffset: 0 }, timestamp: [t0, t0 + DAY, t0 + 4 * DAY], indicators: { quote: [{ close: [0.7, 0.71, 0.72] }] } }] } });
};

const ANSWER = {
  narrative: "The market prices Obsidian as a small oil producer with too much debt.",
  narrativeDetail: "Its output grew while prices fell.",
  drivers: [{ category: "Industry & cycle", title: "Oil prices set the cash flow", summary: "Cheaper oil means less cash.", text: "Revenue fell.", exhibits: [{ title: "Revenue", chart: "bar", series: ["line:revenue"], takeaway: "Down." }] }],
};
let asked: string[] = [];
const fake: Complete = async ({ prompt, system }) => {
  if (system.includes("equity research reports")) return { text: "## Summary\n[EXHIBIT 1]", model: "fake" };
  if (system.includes("WHY the market holds")) return { text: JSON.stringify({ summary: "Debt worries.", claims: [{ text: "Revenue fell in 2025.", drivers: [1], sources: [{ type: "exhibit", ref: "1", label: "Revenue" }] }], exhibits: [] }), model: "fake" };
  asked.push(prompt.includes("Write the LONG thesis") ? "long" : "short");
  return { text: JSON.stringify(ANSWER), model: "fake" };
};
const ctx = (): SourceContext => ({ env: { REPO_ROOT, CLAUDE_OAUTH_TOKEN: "t" }, fetch: (async (u: string | URL) => yahooFx(String(u))) as typeof fetch, complete: fake });

let db: Db;
let close: () => Promise<void>;
const line = (symbol: string, periodType: "year" | "quarter", periodEnd: string, l: string, value: number) => ({ symbol, periodType, periodEnd, line: l, statement: "income" as const, value, currency: "CAD", label: l, consolidated: true, sources: ["yahoo"], alternatives: [] });

beforeEach(async () => {
  asked = [];
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  // Scope = OBE alone (the fixture's other analysed tickers have nothing collected here).
  await db.update(silver.tickers).set({ analysed: false });
  await db.update(silver.tickers).set({ analysed: true }).where(eq(silver.tickers.symbol, OBE));
  // A CAD valuation (statements) of a USD listing (NYSE quote), as in prod on 2026-11-10.
  await db.insert(valuations).values({ symbol: OBE, currency: "CAD", quoteCurrency: null, lastFiscalYear: "2025-12", yearsCovered: 2, evEbitdaYears: [], inputs: {} });
  await db.insert(gold.quotes).values({ symbol: OBE, date: "2026-11-09", close: 9.22, currency: "USD", sources: ["yahoo"] });
  await db.insert(goldFinancialLines).values([line(OBE, "year", "2024-12", "revenue", 800e6), line(OBE, "year", "2025-12", "revenue", 700e6)]);
  await db.insert(valuationSyntheses).values({ symbol: OBE, inputHash: "h", result: { currency: "CAD", low: 9.69, base: 13.4, high: 17.54, weights: [], label: "EV/EBITDA", summary: "s", report: "r" }, bronzeId: "00000000-0000-4000-8000-000000000001", createdAt: new Date("2026-11-09T06:00:00Z") });
});
afterEach(async () => close());

describe("fair value and quote in different currencies (OBE: CAD statements, USD listing)", () => {
  it("without a stored rate: no thesis asked, a failed fetch names the missing pair", async () => {
    await rebuildValuationGold(db);
    expect(await comparablePrice(db, OBE)).toEqual({ reason: "fair value in CAD, quote in USD: no CAD/USD exchange rate stored (dimension fx)" });
    expect(await analysisSubjects(db)).toEqual([OBE]);
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    const [row] = await db.select().from(bronze).where(and(eq(bronze.dimension, "analysis"), eq(bronze.subject, OBE)));
    expect(row.error).toBe("no thesis: fair value in CAD, quote in USD: no CAD/USD exchange rate stored (dimension fx)");
    expect(asked).toEqual([]);
  });

  it("stores the CAD/USD rate (bronze -> silver -> gold), shows the fair value in USD with its conversion, and asks both theses", async () => {
    expect(await neededPairs(db)).toEqual(["CAD/USD"]);
    await runDimension(db, fxDim, { trigger: "test", ctx: ctx() });
    const rates = await db.select().from(gold.fxRates);
    expect(rates.map((r) => [r.date, r.rate])).toEqual([["2026-11-05", 0.7], ["2026-11-06", 0.71], ["2026-11-09", 0.72]]);
    expect((await db.select().from(silver.fxRates)).every((r) => r.sources.join() === "yahoo" && r.bronzeIds.length === 1)).toBe(true);

    await rebuildValuationGold(db);
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, OBE));
    expect(fv.currency).toBe("USD");
    expect(fv.value).toBeCloseTo(13.4 * 0.72, 6);
    expect(fv.low).toBeCloseTo(9.69 * 0.72, 6);
    expect(fv.high).toBeCloseTo(17.54 * 0.72, 6);
    expect(fv.conversion).toEqual({ from: "CAD", to: "USD", rate: 0.72, date: "2026-11-09", source: "yahoo", value: 13.4, low: 9.69, high: 17.54 });

    // 9.22 USD sits inside the converted range (6.98 to 12.63 USD): both theses compete.
    expect(await currentSides(db, OBE)).toEqual(["long", "short"]);
    expect(await analysisSubjects(db)).toEqual([`${OBE}:long`, `${OBE}:short`]);
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(bronze).where(eq(bronze.dimension, "analysis"))).map((r) => r.error)).toEqual([null, null]);
    expect(asked.sort()).toEqual(["long", "short"]);
    expect((await db.select().from(narratives)).map((n) => n.id).sort()).toEqual([`${OBE}:long`, `${OBE}:short`]);

    // The fair value history the judges read is in USD too, at that day's rate.
    await runDimension(db, marketReactionDim, { trigger: "test", ctx: ctx() });
    const [h] = await db.select().from(fairValueHistory).where(eq(fairValueHistory.symbol, OBE));
    expect(h.currency).toBe("USD");
    expect(h.value).toBeCloseTo(13.4 * 0.72, 6);
    expect(h.conversion).toMatchObject({ from: "CAD", rate: 0.72, date: "2026-11-09" });
  });

  it("the rate known on a day is the last close on or before it", () => {
    const s = { base: "CAD", quote: "USD", points: [{ date: "2026-11-05", rate: 0.7, sources: ["yahoo"] }, { date: "2026-11-09", rate: 0.72, sources: ["yahoo"] }] };
    expect(rateOn(s, "2026-11-08")?.rate).toBe(0.7);
    expect(rateOn(s)?.rate).toBe(0.72);
    expect(rateOn({ ...s, points: [] })).toBeNull();
  });
});

describe("a ticker with no analysis possible", () => {
  it("writes a failed fetch with a readable reason, never a silent skip", async () => {
    await db.delete(valuationSyntheses);
    await rebuildValuationGold(db);
    expect(await analysisSubjects(db)).toEqual([OBE]);
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    const [row] = await db.select().from(bronze).where(and(eq(bronze.dimension, "analysis"), eq(bronze.subject, OBE)));
    expect(row.error).toBe("no thesis: no fair value yet (the valuation produced none for this ticker)");
  });
});

describe("annual revenue a source left out (DRX.TO: Yahoo serves gross profit and cost of revenue, no annual revenue)", () => {
  const DRX = "DRX.TO";
  it("is derived from gross profit + cost of revenue, as a metric with its formula and inputs, and passes the financials gate", async () => {
    const lines = [line(DRX, "year", "2025-01", "gross-profit", 60e6), line(DRX, "year", "2025-01", "cost-of-revenue", 240e6), line(DRX, "year", "2025-01", "operating-income", 30e6)];
    const metrics = deriveMetrics(DRX, lines);
    const rev = metrics.find((m) => m.metric === "revenue");
    expect(rev).toMatchObject({ periodType: "year", periodEnd: "2025-01", value: 300e6, formula: "gross profit + cost of revenue", currency: "CAD" });
    expect(rev!.inputs.map((i) => i.line)).toEqual(["gross-profit", "cost-of-revenue"]);
    // Never presented as reported: no revenue line appears.
    expect(lines.some((l) => l.line === "revenue")).toBe(false);

    await db.insert(goldFinancialLines).values(lines);
    await db.insert(financialMetrics).values(metrics);
    expect((await gatherFacts(db, DRX)).hasFinancials).toBe(true);
    const none = "CCLD";
    expect((await gatherFacts(db, none)).hasFinancials).toBe(false);
  });

  it("else from the 4 reported quarters of the fiscal year, only when all 4 are there", () => {
    const q = (pe: string, v: number) => line(DRX, "quarter", pe, "revenue", v);
    const year = line(DRX, "year", "2025-01", "operating-income", 30e6);
    const all = deriveMetrics(DRX, [year, q("2025-01", 80e6), q("2024-10", 70e6), q("2024-07", 75e6), q("2024-04", 75e6)]).find((m) => m.metric === "revenue" && m.periodType === "year");
    expect(all).toMatchObject({ value: 300e6, formula: "sum of the 4 reported quarters of the fiscal year" });
    expect(all!.inputs.map((i) => i.periodEnd)).toEqual(["2025-01", "2024-10", "2024-07", "2024-04"]);
    const three = deriveMetrics(DRX, [year, q("2025-01", 80e6), q("2024-10", 70e6), q("2024-07", 75e6)]).find((m) => m.metric === "revenue" && m.periodType === "year");
    expect(three).toBeUndefined();
  });
});
