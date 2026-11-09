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
import { valuationDim, valuationFactsHash } from "./dimensions/valuation";
import { dataAsOf, methodSpec, peerMedian, peerPriced, runScenarios, weighted, type ValuationFacts } from "./dimensions/valuation/methods";
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
  });
  it("peers' median of the multiple the method prices off (P/E per basis), peers without it left out; a premium moves it", () => {
    const f = { ...facts(), peers: [
      { symbol: "A", name: "A", currency: "USD", evEbitda: 6, pe: 10, peForward: 9, pb: null, sources: [] },
      { symbol: "B", name: "B", currency: "USD", evEbitda: 8, pe: null, peForward: 11, pb: 2, sources: [] },
      { symbol: "C", name: "C", currency: "USD", evEbitda: 12, pe: 14, sources: [] },
    ] };
    expect(peerMedian(methodSpec("ev-ebitda"), f, null)).toEqual({ id: "ev-ebitda", label: "EV/EBITDA", median: 8, count: 3 });
    expect(peerMedian(methodSpec("pe"), f, "trailing")).toMatchObject({ id: "pe", median: 12, count: 2 });
    expect(peerMedian(methodSpec("pe"), f, "forward")).toMatchObject({ id: "pe-forward", median: 10, count: 2 });
    expect(peerMedian(methodSpec("pb"), f, null)).toMatchObject({ median: 2, count: 1 });
    expect(peerMedian(methodSpec("dcf"), f, "average")).toBeNull();
    expect(peerMedian(methodSpec("pb"), facts(), null)).toBeNull();
    // CCLD-like: peers at 8x, much smaller company: a 25% discount for base, 12.5% for high = 6x and 7x.
    expect(peerPriced(8, { base: -0.25, high: -0.125 })).toEqual({ base: 6, high: 7 });
    expect(() => peerPriced(8, { base: -1.2, high: 0 })).toThrow(/above -100%/);
  });
  it("weighted fair value normalises the weights over the methods given", () => {
    const w = weighted([{ method: "ev-ebitda", low: 1, base: 2, high: 3 }, { method: "dcf", low: 3, base: 4, high: 5 }], { "ev-ebitda": 30, dcf: 10 });
    expect(w).toEqual({ low: 1.5, base: 2.5, high: 3.5, weights: { "ev-ebitda": 0.75, dcf: 0.25 } });
  });
});

describe("input hash: a price tick does not re-ask the methods", () => {
  const withMarket = (peerEv: number, targetMean: number): ValuationFacts => ({
    ...facts(),
    peers: [
      { symbol: "B", name: "B", currency: "USD", evEbitda: peerEv * 1.2, pe: 14, sources: ["yahoo"] },
      { symbol: "A", name: "A", currency: "USD", evEbitda: peerEv, pe: 12, sources: ["yahoo"] },
    ],
    targets: { low: targetMean * 0.8, mean: targetMean, high: targetMean * 1.2, analysts: 3, currency: "USD", sources: ["yahoo"] },
  });
  it("same hash when peers' multiples and targets drift a few percent, or their sources and order change", () => {
    const a = withMarket(8, 12);
    const b = withMarket(8.1, 12.1);
    b.peers = [...b.peers].reverse().map((p) => ({ ...p, sources: ["yahoo", "other"] }));
    expect(valuationFactsHash(b, 3, "ctx")).toBe(valuationFactsHash(a, 3, "ctx"));
  });
  it("new hash when a peer multiple moves a whole step, or a reported figure changes", () => {
    const a = withMarket(8, 12);
    expect(valuationFactsHash(withMarket(12, 12), 3, "ctx")).not.toBe(valuationFactsHash(a, 3, "ctx"));
    const c = withMarket(8, 12);
    c.inputs = { ...c.inputs, ebitda: { ...c.inputs.ebitda!, value: 301 } };
    expect(valuationFactsHash(c, 3, "ctx")).not.toBe(valuationFactsHash(a, 3, "ctx"));
  });
});

describe("data freshness", () => {
  it("is the latest date the inputs carry (a month = its last day), never when it ran", () => {
    const ran = new Date("2026-11-06T10:00:00Z");
    expect(dataAsOf([{ period: "fiscal year 2025-12" }, { period: "last 4 quarters to 2026-09" }], ran).toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(dataAsOf([{ period: "quarter 2026-06" }, { period: "2026-11-05" }], ran).toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(dataAsOf([{ period: "today" }], ran)).toBe(ran);
    expect(dataAsOf([{ period: "fiscal year 2026-12, 3 analysts" }], ran)).toBe(ran);
  });
});

describe("peers parsing", () => {
  it("keeps 4 to 6 listed comparables, never the company itself", () => {
    expect(parsePeers('{"peers":[{"symbol":"101160.kq","name":"Self"},{"symbol":"042700.KS","name":"Hanmi — Semi","why":"Same tools"}]}', "101160.KQ")).toEqual([{ symbol: "042700.KS", name: "Hanmi, Semi", why: "Same tools" }]);
  });
  it("reads multiples and targets, drops a negative multiple", () => {
    const s = readSummary({ quoteSummary: { result: [{ price: { longName: "Peer", currency: "KRW" }, summaryDetail: { trailingPE: { raw: -3 } }, defaultKeyStatistics: { enterpriseToEbitda: { raw: 7.5 } }, financialData: { targetLowPrice: { raw: 9 }, targetMeanPrice: { raw: 11 }, targetHighPrice: { raw: 14 }, numberOfAnalystOpinions: { raw: 3 } } }] } });
    expect(s).toEqual({ name: "Peer", currency: "KRW", evEbitda: 7.5, pe: null, peForward: null, pb: null, marketCap: null, revenueGrowth: null, ebitdaMargin: null, targets: { low: 9, mean: 11, high: 14, analysts: 3 } });
  });
});

let calls: string[] = [];
let prompts: string[] = [];
const fake: Complete = async ({ prompt, system }) => {
  const json = (o: unknown) => ({ text: JSON.stringify(o), model: "fake" });
  if (system.includes("pick trading comparables")) {
    calls.push("peers");
    return json({ peers: [{ symbol: "042700.KS", name: "Hanmi", why: "Same equipment" }] });
  }
  if (system.includes("head of research")) {
    if (prompt.includes('"weights"')) {
      calls.push("weights");
      return json({ weights: { "ev-ebitda": { weight: 60, why: "Cyclical: through the cycle." }, pe: { weight: 40, why: "Earnings are steady." }, "analyst-targets": { weight: 0, why: "One analyst." }, dcf: { weight: 0, why: "x" }, pb: { weight: 0, why: "x" }, "net-assets": { weight: 0, why: "x" } } });
    }
    calls.push("report");
    expect(prompt).toContain("Fair value (weighted by the code)");
    return json({ summary: "Fair value rests on EV/EBITDA and P/E.", report: "## Conclusion\nIt holds." });
  }
  const method = /Method: ([^.]+)\./.exec(prompt)?.[1] ?? "?";
  calls.push(`method:${method}`);
  if (method.startsWith("P/B")) return json({ applicable: false, reason: "Book value says little for this business." });
  // A multiple with a peers' median: the low on its own history, a discount / premium to the peers for base and high.
  if (prompt.includes("Peers' median") && /: \d+\.\d+x over/.test(prompt) && (method === "EV/EBITDA" || method === "P/E")) {
    prompts.push(prompt);
    return json({ applicable: true, basis: "trailing", assumptions: { multiple: { low: method === "P/E" ? 6 : 4, why: "Its 5-year low." } }, peers: { base: -0.1, high: 0.05, why: "Much smaller than Hanmi, growing slower, thinner margins." }, summary: "It says something.", report: "Short report." });
  }
  const keys: Record<string, Record<string, [number, number, number]>> = {
    "EV/EBITDA": { multiple: [4, 6, 8] },
    "P/E": { multiple: [6, 8, 10] },
    "DCF on free cash flow": { growth: [0, 0.02, 0.04], terminalGrowth: [0.01, 0.02, 0.02], discountRate: [0.12, 0.1, 0.09] },
    "Net cash and assets": { recovery: [0.2, 0.4, 0.6] },
  };
  const a = Object.fromEntries(Object.entries(keys[method] ?? {}).map(([k, [low, base, high]]) => [k, { low, base, high, why: "From its history." }]));
  return json({ applicable: true, basis: method === "P/E" ? "trailing" : "average", assumptions: a, summary: "It says something.", report: "Short report." });
};

const yahoo = (url: string) => {
  if (url.includes("fc.yahoo.com")) return new Response("", { status: 200, headers: { "set-cookie": "A3=x; path=/" } });
  if (url.includes("getcrumb")) return new Response("crumb1", { status: 200 });
  const sym = decodeURIComponent(/quoteSummary\/([^?]+)/.exec(url)?.[1] ?? "");
  const body = sym === "042700.KS"
    ? { price: { longName: "Hanmi Semiconductor", currency: "KRW", marketCap: { raw: 9e12 } }, summaryDetail: { trailingPE: { raw: 12 } }, defaultKeyStatistics: { enterpriseToEbitda: { raw: 7 }, priceToBook: { raw: 2.5 } }, financialData: { revenueGrowth: { raw: 0.3 }, ebitdaMargins: { raw: 0.35 } } }
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
  prompts = [];
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await db.insert(goldFinancialLines).values([line("2024-12", "revenue", 300e9), line("2025-12", "revenue", 290e9), line("2025-12", "eps-diluted", 3000), line("2025-12", "equity", 400e9, "balance")]);
  await db.insert(financialMetrics).values([metric("2023-12", "ev-ebitda", 5, "multiple"), metric("2024-12", "ev-ebitda", 7, "multiple"), metric("2025-12", "ev-ebitda", 6, "multiple"), metric("2024-12", "fcf", 40e9), metric("2025-12", "fcf", 50e9), { ...metric("2025-12", "revenue-growth", -0.033), unit: "ratio" as const, currency: null }, { ...metric("2025-12", "ebitda-margin", 0.24), unit: "ratio" as const, currency: null }]);
  await db.insert(valuations).values({ symbol: SYMBOL, currency: "KRW", quoteCurrency: "KRW", lastFiscalYear: "2025-12", yearsCovered: 2, evEbitdaLow: 5, evEbitdaMedian: 6, evEbitdaHigh: 7, evEbitdaYears: ["2023-12", "2024-12", "2025-12"], quoteDate: "2026-11-05", quote: 30000, sharesOutstanding: 16.5e6, netDebt: -100e9, ebitda: 70e9, ebitdaBasis: "fiscal year 2025-12", marketCap: 495e9, ev: 395e9, evEbitda: 5.6, inputs: {} });
});
afterEach(async () => close());

describe("fair value pyramid", () => {
  it("peers, every method, then the weighted Fair Value with its range and report; same inputs never asked again", async () => {
    await runDimension(db, peersDim, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(peers).where(eq(peers.symbol, SYMBOL))).map((p) => [p.symbol, p.peerSymbol, p.evEbitda, p.pe, p.pb, p.marketCap, p.revenueGrowth, p.ebitdaMargin])).toEqual([[SYMBOL, "042700.KS", 7, 12, 2.5, 9e12, 0.3, 0.35]]);
    expect((await db.select().from(analystTargets).where(eq(analystTargets.symbol, SYMBOL)))[0]).toMatchObject({ symbol: SYMBOL, low: 35000, mean: 42000, high: 50000, analysts: 2 });

    calls = [];
    const report = await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("succeeded");
    // No dividend: no call for it; analyst targets are read, not asked.
    // Listed peers is no method of its own any more: the multiples price off the peers.
    expect(calls.slice(0, 5).sort()).toEqual(["method:DCF on free cash flow", "method:EV/EBITDA", "method:Net cash and assets", "method:P/B, book value", "method:P/E"]);
    expect(calls.slice(5)).toEqual(["weights", "report"]);
    // The model sees the company beside its peers: size, growth, margins.
    expect(prompts[0]).toContain("revenue growth last fiscal year -3.3%, EBITDA margin 24.0%");
    expect(prompts[0]).toContain("Hanmi Semiconductor (042700.KS): EV/EBITDA 7.0x, P/E 12.0x, forward P/E n/a, P/B 2.5x; market cap 9000.00B KRW, revenue growth 30.0%, EBITDA margin 35.0%");
    const rows = new Map((await db.select().from(goldMethodValuations)).map((r) => [r.method, r]));
    // Low on its own history (4x); base and high = the peers' median 7x with a 10% discount and a 5% premium.
    const ev0 = rows.get("ev-ebitda")!;
    expect(ev0.applicable).toBe(1);
    expect(ev0.low).toBeCloseTo((4 * 70e9 + 100e9) / 16.5e6, 6);
    expect(ev0.base).toBeCloseTo((6.3 * 70e9 + 100e9) / 16.5e6, 6);
    expect(ev0.high).toBeCloseTo((7.35 * 70e9 + 100e9) / 16.5e6, 6);
    expect(ev0.peerPricing).toEqual({ multiple: "ev-ebitda", label: "EV/EBITDA", median: 7, count: 1, premium: { base: -0.1, high: 0.05 }, why: "Much smaller than Hanmi, growing slower, thinner margins." });
    expect(ev0.assumptions.map((a) => [a.key, a.low, a.base, a.high])).toEqual([["multiple", 4, expect.closeTo(6.3, 9), expect.closeTo(7.35, 9)], ["peer-premium", expect.closeTo(4 / 7 - 1, 9), -0.1, 0.05]]);
    expect(ev0.peers.map((p) => p.symbol)).toEqual(["042700.KS"]);
    const pe0 = rows.get("pe")!;
    expect(pe0.peerPricing?.median).toBe(12);
    expect([pe0.low, pe0.base, pe0.high].map((x) => x! / 3000)).toEqual([6, expect.closeTo(10.8, 9), expect.closeTo(12.6, 9)]);
    expect(rows.get("ev-ebitda")!.history?.points.map((p) => p.value)).toEqual([5, 7, 6]);
    expect(rows.get("ev-ebitda")!.dataAsOf?.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(rows.get("pb")).toMatchObject({ applicable: 0, reason: "Book value says little for this business." });
    expect(rows.get("dividend-yield")).toMatchObject({ applicable: 0, reason: "No dividend paid last fiscal year." });
    expect(rows.get("analyst-targets")).toMatchObject({ applicable: 1, low: 35000, base: 42000, high: 50000 });
    expect(rows.get("peers")).toBeUndefined();

    const ev = rows.get("ev-ebitda")!;
    const pr = rows.get("pe")!;
    const [rep] = await db.select().from(valuationReports);
    expect(rep.base).toBeCloseTo(0.6 * ev.base! + 0.4 * pr.base!, 4);
    expect(rep.low).toBeCloseTo(0.6 * ev.low! + 0.4 * pr.low!, 4);
    expect(rep.weights.find((w) => w.method === "ev-ebitda")?.weight).toBeCloseTo(0.6, 6);
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ author: "claude", currency: "KRW", low: rep.low, high: rep.high });
    expect(fv.value).toBeCloseTo(rep.base, 6);
    expect(fv.method).toBe("EV/EBITDA 60%, P/E 40%");
    expect((await db.select().from(valuationMethods)).length).toBe(7);

    calls = [];
    await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);
    expect((await db.select().from(valuationReports))[0].version).toBe(rep.version);
  });

  it("no peers collected: the multiple runs all three cases on its own history, and says so", async () => {
    await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    expect(prompts).toEqual([]);
    const [ev] = await db.select().from(goldMethodValuations).where(eq(goldMethodValuations.id, `${SYMBOL}:ev-ebitda`));
    expect(ev.peerPricing).toBeNull();
    expect(ev.base).toBeCloseTo((6 * 70e9 + 100e9) / 16.5e6, 6);
  });

  it("Thierry's own fair value wins, the weighted one is kept beside it", async () => {
    await db.insert(theses).values({ symbol: SYMBOL, fairValue: 45000, fairValueBasis: "his model", currency: "KRW" }).onConflictDoUpdate({ target: theses.symbol, set: { fairValue: 45000, fairValueBasis: "his model", currency: "KRW" } });
    await runDimension(db, valuationDim, { trigger: "test", ctx: ctx() });
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ value: 45000, method: "his model", author: "thierry", low: null, high: null });
    expect(fv.claudeValue).toBeGreaterThan(0);
  });
});
