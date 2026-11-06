import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fairValues } from "@/db/schema/analysis";
import { financialMetrics, goldFinancialLines, valuations } from "@/db/schema/financials";
import { theses } from "@/db/schema/thesis";
import { analystTargets, goldMethodValuations, peers, valuationMethods, valuationReports } from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { parsePeers, peersDim, readSummary } from "./dimensions/peers";
import { valuationDim } from "./dimensions/valuation";
import { methodSpec, runScenarios, weighted, type ValuationFacts } from "./dimensions/valuation/methods";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const SYMBOL = "101160.KQ";

const facts = (over: Partial<ValuationFacts["inputs"]> = {}): ValuationFacts => ({
  symbol: "X",
  name: "X Co",
  currency: "USD",
  quote: { price: 10, date: "2026-11-05" },
  inputs: {
    shares: { key: "shares", label: "Shares", value: 100, unit: "count", period: "FY", sources: ["sec"] },
    "net-debt": { key: "net-debt", label: "Net debt", value: 200, unit: "currency", period: "FY", sources: ["sec"] },
    ebitda: { key: "ebitda", label: "EBITDA", value: 300, unit: "currency", period: "FY", sources: ["sec"] },
    "fcf-average": { key: "fcf-average", label: "FCF", value: 100, unit: "currency", period: "FY", sources: ["sec"] },
    equity: { key: "equity", label: "Equity", value: 500, unit: "currency", period: "FY", sources: ["sec"] },
    ...over,
  },
  history: {},
  peers: [],
  targets: null,
});

describe("valuation methods: the arithmetic", () => {
  it("EV/EBITDA: multiple x EBITDA - net debt, per share; scenarios ordered by value", () => {
    const r = runScenarios(methodSpec("ev-ebitda"), facts(), { low: { multiple: 6 }, base: { multiple: 4 }, high: { multiple: 5 } }, null);
    expect([r.low, r.base, r.high]).toEqual([(4 * 300 - 200) / 100, (5 * 300 - 200) / 100, (6 * 300 - 200) / 100]);
    expect(r.steps.find((s) => s.label === "Enterprise value")).toMatchObject({ low: 1200, base: 1500, high: 1800 });
  });
  it("DCF: five years grown and discounted plus a terminal value", () => {
    const r = runScenarios(methodSpec("dcf"), facts(), { low: { growth: 0, terminalGrowth: 0, discountRate: 0.1 }, base: { growth: 0, terminalGrowth: 0, discountRate: 0.1 }, high: { growth: 0, terminalGrowth: 0, discountRate: 0.1 } }, "average");
    // Flat 100 a year at 10% forever = 1,000 of EV; minus 200 of net debt; 100 shares.
    expect(r.base).toBeCloseTo(8, 6);
    expect(() => runScenarios(methodSpec("dcf"), facts(), { low: { growth: 0, terminalGrowth: 0.05, discountRate: 0.055 }, base: { growth: 0, terminalGrowth: 0, discountRate: 0.1 }, high: { growth: 0, terminalGrowth: 0, discountRate: 0.1 } }, "average")).toThrow(/terminal growth/);
  });
  it("not applicable says why", () => {
    expect(methodSpec("ev-ebitda").notApplicable(facts({ ebitda: { key: "ebitda", label: "EBITDA", value: -5, unit: "currency", period: "FY", sources: [] } }))).toMatch(/negative/);
    expect(methodSpec("dividend-yield").notApplicable(facts())).toBe("No dividend paid last fiscal year.");
    expect(methodSpec("peers").notApplicable(facts())).toMatch(/comparable/);
  });
  it("weighted fair value normalises the weights over the methods given", () => {
    const w = weighted([{ method: "ev-ebitda", low: 1, base: 2, high: 3 }, { method: "dcf", low: 3, base: 4, high: 5 }], { "ev-ebitda": 30, dcf: 10 });
    expect(w).toEqual({ low: 1.5, base: 2.5, high: 3.5, weights: { "ev-ebitda": 0.75, dcf: 0.25 } });
  });
});

describe("peers parsing", () => {
  it("keeps 4 to 6 listed comparables, never the company itself", () => {
    expect(parsePeers('{"peers":[{"symbol":"101160.kq","name":"Self"},{"symbol":"042700.KS","name":"Hanmi — Semi","why":"Same tools"}]}', "101160.KQ")).toEqual([{ symbol: "042700.KS", name: "Hanmi, Semi", why: "Same tools" }]);
  });
  it("reads multiples and targets, drops a negative multiple", () => {
    const s = readSummary({ quoteSummary: { result: [{ price: { longName: "Peer", currency: "KRW" }, summaryDetail: { trailingPE: { raw: -3 } }, defaultKeyStatistics: { enterpriseToEbitda: { raw: 7.5 } }, financialData: { targetLowPrice: { raw: 9 }, targetMeanPrice: { raw: 11 }, targetHighPrice: { raw: 14 }, numberOfAnalystOpinions: { raw: 3 } } }] } });
    expect(s).toEqual({ name: "Peer", currency: "KRW", evEbitda: 7.5, pe: null, targets: { low: 9, mean: 11, high: 14, analysts: 3 } });
  });
});

let calls: string[] = [];
const fake: Complete = async ({ prompt, system }) => {
  const json = (o: unknown) => ({ text: JSON.stringify(o), model: "fake" });
  if (system.includes("pick trading comparables")) {
    calls.push("peers");
    return json({ peers: [{ symbol: "042700.KS", name: "Hanmi", why: "Same equipment" }] });
  }
  if (system.includes("head of research")) {
    if (prompt.includes('"weights"')) {
      calls.push("weights");
      return json({ weights: { "ev-ebitda": { weight: 60, why: "Cyclical: through the cycle." }, peers: { weight: 40, why: "Listed peers trade near it." }, "analyst-targets": { weight: 0, why: "One analyst." }, dcf: { weight: 0, why: "x" }, pb: { weight: 0, why: "x" }, "net-assets": { weight: 0, why: "x" }, pe: { weight: 0, why: "x" } } });
    }
    calls.push("report");
    expect(prompt).toContain("Fair value (weighted by the code)");
    return json({ summary: "Fair value rests on EV/EBITDA and peers.", report: "## Conclusion\nIt holds." });
  }
  const method = /Method: ([^.]+)\./.exec(prompt)?.[1] ?? "?";
  calls.push(`method:${method}`);
  if (method.startsWith("P/B")) return json({ applicable: false, reason: "Book value says little for this business." });
  const keys: Record<string, Record<string, [number, number, number]>> = {
    "EV/EBITDA, own history": { multiple: [4, 6, 8] },
    "P/E": { multiple: [6, 8, 10] },
    "DCF on free cash flow": { growth: [0, 0.02, 0.04], terminalGrowth: [0.01, 0.02, 0.02], discountRate: [0.12, 0.1, 0.09] },
    "Net cash and assets": { recovery: [0.2, 0.4, 0.6] },
    "Listed peers": { multiple: [6, 7, 8] },
  };
  const a = Object.fromEntries(Object.entries(keys[method] ?? {}).map(([k, [low, base, high]]) => [k, { low, base, high, why: "From its history." }]));
  return json({ applicable: true, basis: method === "P/E" ? "trailing" : method === "Listed peers" ? "ev-ebitda" : "average", assumptions: a, summary: "It says something.", report: "Short report." });
};

const yahoo = (url: string) => {
  if (url.includes("fc.yahoo.com")) return new Response("", { status: 200, headers: { "set-cookie": "A3=x; path=/" } });
  if (url.includes("getcrumb")) return new Response("crumb1", { status: 200 });
  const sym = decodeURIComponent(/quoteSummary\/([^?]+)/.exec(url)?.[1] ?? "");
  const body = sym === "042700.KS"
    ? { price: { longName: "Hanmi Semiconductor", currency: "KRW" }, summaryDetail: { trailingPE: { raw: 12 } }, defaultKeyStatistics: { enterpriseToEbitda: { raw: 7 } }, financialData: {} }
    : sym === SYMBOL
      ? { price: { longName: "Worldex", currency: "KRW" }, summaryDetail: {}, defaultKeyStatistics: {}, financialData: { targetLowPrice: { raw: 35000 }, targetMeanPrice: { raw: 42000 }, targetHighPrice: { raw: 50000 }, numberOfAnalystOpinions: { raw: 2 } } }
      : null;
  return new Response(JSON.stringify({ quoteSummary: { result: body ? [body] : [] } }), { status: 200, headers: { "content-type": "application/json" } });
};
const ctx = (): SourceContext => ({ env: { REPO_ROOT, CLAUDE_OAUTH_TOKEN: "t" }, fetch: (async (u: string | URL) => yahoo(String(u))) as typeof fetch, complete: fake });

let db: Db;
let close: () => Promise<void>;
const line = (periodEnd: string, l: string, value: number, statement: "income" | "balance" | "cashflow" = "income") => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd, line: l, statement, value, currency: "KRW", label: l, consolidated: true, sources: ["dart"], alternatives: [] });
const metric = (periodEnd: string, m: string, value: number, unit: "currency" | "multiple" = "currency") => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd, metric: m, value, unit, currency: unit === "currency" ? "KRW" : null, formula: "x", inputs: [], sources: ["dart"] });

beforeEach(async () => {
  calls = [];
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await db.insert(goldFinancialLines).values([line("2024-12", "revenue", 300e9), line("2025-12", "revenue", 290e9), line("2025-12", "eps-diluted", 3000), line("2025-12", "equity", 400e9, "balance")]);
  await db.insert(financialMetrics).values([metric("2023-12", "ev-ebitda", 5, "multiple"), metric("2024-12", "ev-ebitda", 7, "multiple"), metric("2025-12", "ev-ebitda", 6, "multiple"), metric("2024-12", "fcf", 40e9), metric("2025-12", "fcf", 50e9)]);
  await db.insert(valuations).values({ symbol: SYMBOL, currency: "KRW", quoteCurrency: "KRW", lastFiscalYear: "2025-12", yearsCovered: 2, evEbitdaLow: 5, evEbitdaMedian: 6, evEbitdaHigh: 7, evEbitdaYears: ["2023-12", "2024-12", "2025-12"], quoteDate: "2026-11-05", quote: 30000, sharesOutstanding: 16.5e6, netDebt: -100e9, ebitda: 70e9, ebitdaBasis: "fiscal year 2025-12", marketCap: 495e9, ev: 395e9, evEbitda: 5.6, inputs: {} });
});
afterEach(async () => close());

describe("fair value pyramid", () => {
  it("peers, every method, then the weighted Fair Value with its range and report; same inputs never asked again", async () => {
    await runDimension(db, peersDim, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(peers).where(eq(peers.symbol, SYMBOL))).map((p) => [p.symbol, p.peerSymbol, p.evEbitda, p.pe])).toEqual([[SYMBOL, "042700.KS", 7, 12]]);
    expect((await db.select().from(analystTargets).where(eq(analystTargets.symbol, SYMBOL)))[0]).toMatchObject({ symbol: SYMBOL, low: 35000, mean: 42000, high: 50000, analysts: 2 });

    calls = [];
    const report = await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("succeeded");
    // No dividend: no call for it; analyst targets are read, not asked.
    expect(calls.slice(0, 6).sort()).toEqual(["method:DCF on free cash flow", "method:EV/EBITDA, own history", "method:Listed peers", "method:Net cash and assets", "method:P/B, book value", "method:P/E"]);
    expect(calls.slice(6)).toEqual(["weights", "report"]);
    const rows = new Map((await db.select().from(goldMethodValuations)).map((r) => [r.method, r]));
    expect(rows.get("ev-ebitda")).toMatchObject({ applicable: 1, low: (4 * 70e9 + 100e9) / 16.5e6, base: (6 * 70e9 + 100e9) / 16.5e6, high: (8 * 70e9 + 100e9) / 16.5e6 });
    expect(rows.get("ev-ebitda")!.history?.points.map((p) => p.value)).toEqual([5, 7, 6]);
    expect(rows.get("pb")).toMatchObject({ applicable: 0, reason: "Book value says little for this business." });
    expect(rows.get("dividend-yield")).toMatchObject({ applicable: 0, reason: "No dividend paid last fiscal year." });
    expect(rows.get("analyst-targets")).toMatchObject({ applicable: 1, low: 35000, base: 42000, high: 50000 });
    expect(rows.get("peers")!.peers.map((p) => p.symbol)).toEqual(["042700.KS"]);

    const ev = rows.get("ev-ebitda")!;
    const pr = rows.get("peers")!;
    const [rep] = await db.select().from(valuationReports);
    expect(rep.base).toBeCloseTo(0.6 * ev.base! + 0.4 * pr.base!, 4);
    expect(rep.low).toBeCloseTo(0.6 * ev.low! + 0.4 * pr.low!, 4);
    expect(rep.weights.find((w) => w.method === "ev-ebitda")?.weight).toBeCloseTo(0.6, 6);
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ author: "claude", currency: "KRW", low: rep.low, high: rep.high });
    expect(fv.value).toBeCloseTo(rep.base, 6);
    expect(fv.method).toBe("EV/EBITDA, own history 60%, Listed peers 40%");
    expect((await db.select().from(valuationMethods)).length).toBe(8);

    calls = [];
    await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);
    expect((await db.select().from(valuationReports))[0].version).toBe(rep.version);
  });

  it("Thierry's own fair value wins, the weighted one is kept beside it", async () => {
    await db.insert(theses).values({ symbol: SYMBOL, fairValue: 45000, fairValueBasis: "his model", currency: "KRW" }).onConflictDoUpdate({ target: theses.symbol, set: { fairValue: 45000, fairValueBasis: "his model", currency: "KRW" } });
    await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ value: 45000, method: "his model", author: "thierry", low: null, high: null });
    expect(fv.claudeValue).toBeGreaterThan(0);
  });
});
