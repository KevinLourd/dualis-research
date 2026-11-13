import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldOperatingKpis, operatingKpis, revenueStreams } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { CompleteRequest } from "@/llm/complete";
import { testDb } from "@/test/db";
import { figuresText, gatherFacts } from "./dimensions/analysis/facts";
import { seriesCatalog } from "./dimensions/analysis/series";
import { batchPrompt } from "./dimensions/evidence";
import { operatingKpisDim } from "./dimensions/operating-kpis";
import { revenueFor } from "./dimensions/operating-kpis/derive";
import { filingDocuments, htmlText, kpiReadings, KPI_EXTRACT_VERSION, verifyItems, type KpiItem } from "./dimensions/operating-kpis/sources";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

/**
 * Fake documents for three analysed tickers that report a backlog (the figures are invented for the test; the real
 * ones come from their filings in production): RCM Technologies' 10-K, SuperCom's earnings release (the EX-99.1 of an
 * 8-K "results of operations"), Magnachip's 10-Q.
 */
const RCMT_10K = `<html><head><title>x</title></head><body><ix:header><ix:hidden>backlog 999,999</ix:hidden></ix:header>
<p>Item 1. Business</p>
<p>Backlog. As of December&nbsp;27, 2025, our backlog was $310.5 million, compared to $195.0 million as of December 28, 2024. Our customers renew most contracts.</p>
<table><tr><td>Revenue</td><td>290.0</td></tr></table></body></html>`;
const SPCB_RELEASE = `<html><body><p>SuperCom Reports Third Quarter 2026 Results</p>
<p>Backlog reached $62.4 million at September 30, 2026, up from $28.0 million at September 30, 2025, driven by new contracts in electronic monitoring.</p></body></html>`;
const MX_10Q = `<html><body><p>Item 2. Management's Discussion and Analysis</p>
<p>Our backlog was $45.0 million as of September 30, 2026. The book-to-bill ratio for the quarter was 1.3.</p></body></html>`;

const DAY = 86_400_000;
const filed = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
const FILINGS = [
  { symbol: "RCMT", registry: "sec", form: "10-K", title: "10-K annual report", url: "https://www.sec.gov/Archives/edgar/data/1/0001/rcmt-10k.htm", filedAt: filed(200) },
  { symbol: "SPCB", registry: "sec", form: "8-K", title: "8-K: results of operations", url: "https://www.sec.gov/Archives/edgar/data/2/0002/spcb-8k.htm", filedAt: filed(10) },
  { symbol: "MX", registry: "sec", form: "10-Q", title: "10-Q quarterly report", url: "https://www.sec.gov/Archives/edgar/data/3/0003/mx-10q.htm", filedAt: filed(20) },
  // A Form 4 is no periodic report: never read.
  { symbol: "MX", registry: "sec", form: "4", title: "Insider trade", url: "https://www.sec.gov/Archives/edgar/data/3/0004/f4.htm", filedAt: filed(5) },
];

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  if (url.endsWith("rcmt-10k.htm")) return html(RCMT_10K);
  if (url.endsWith("0002/index.json")) return new Response(JSON.stringify({ directory: { item: [{ name: "spcb-8k.htm" }, { name: "ex99-1.htm" }] } }), { status: 200 });
  if (url.endsWith("0002/ex99-1.htm")) return html(SPCB_RELEASE);
  if (url.endsWith("mx-10q.htm")) return html(MX_10Q);
  throw new Error(`unexpected url ${url}`);
}) as typeof fetch;

const item = (x: Partial<KpiItem> & Pick<KpiItem, "printed" | "quote" | "periodEnd">): KpiItem => ({ kpi: "backlog", name: "Backlog", unit: "currency", scale: "million", currency: "USD", periodType: "instant", passage: 0, ...x });

/** The model's answers per document: true copies, plus two figures the documents never printed (must be dropped). */
const answers: Record<string, KpiItem[]> = {
  "10-K annual report": [
    item({ printed: "$310.5", periodEnd: "2025-12", quote: "As of December 27, 2025, our backlog was $310.5 million, compared to $195.0 million as of December 28, 2024." }),
    item({ printed: "$195.0", periodEnd: "2024-12", quote: "As of December 27, 2025, our backlog was $310.5 million, compared to $195.0 million as of December 28, 2024." }),
    // Invented: the quote is not in the document.
    item({ kpi: "order-intake", name: "Orders received", periodType: "year", printed: "$88.0", periodEnd: "2025-12", quote: "Orders received were $88.0 million in 2025." }),
    // Invented: the quote is real, the figure is not in it.
    item({ printed: "$400.0", periodEnd: "2023-12", quote: "our backlog was $310.5 million" }),
  ],
  "8-K: results of operations": [
    item({ printed: "$62.4", periodEnd: "2026-09", quote: "Backlog reached $62.4 million at September 30, 2026, up from $28.0 million at September 30, 2025" }),
    item({ printed: "$28.0", periodEnd: "2025-09", quote: "Backlog reached $62.4 million at September 30, 2026, up from $28.0 million at September 30, 2025" }),
  ],
  "10-Q quarterly report": [
    item({ printed: "$45.0", periodEnd: "2026-09", quote: "Our backlog was $45.0 million as of September 30, 2026." }),
    item({ kpi: "book-to-bill", name: "Book-to-bill ratio", unit: "ratio", scale: "one", currency: null, periodType: "quarter", printed: "1.3", periodEnd: "2026-09", quote: "The book-to-bill ratio for the quarter was 1.3." }),
  ],
};

const prompts: string[] = [];
const fakeComplete = async (req: CompleteRequest) => {
  prompts.push(req.prompt);
  const title = Object.keys(answers).find((t) => req.prompt.startsWith(`Document: ${t} `))!;
  return { text: JSON.stringify({ kpis: answers[title] }), model: "fake" };
};

const stream = (symbol: string, periodType: "year" | "half" | "quarter", periodEnd: string, value: number, ltm: { value: number; formula: string } | null = null) => ({
  symbol, line: "revenue", axis: "total", name: "Total revenue", periodType, periodEnd, value, currency: "USD", sources: ["sec"], ltmValue: ltm?.value ?? null, ltmFormula: ltm?.formula ?? null,
});

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  prompts.length = 0;
});
afterEach(async () => close());

const ctx: SourceContext = { env: { CLAUDE_OAUTH_TOKEN: "x" }, fetch: fakeFetch, complete: fakeComplete };
const dim = { ...operatingKpisDim, subjects: async () => ["RCMT", "SPCB", "MX"] };

async function seed() {
  await db.insert(gold.filings).values(FILINGS.map((f) => ({ id: randomUUID(), filingKey: f.url, language: "en", sources: ["sec-edgar"], ...f })));
  await db.insert(revenueStreams).values([
    stream("RCMT", "year", "2024-12", 270_000_000),
    stream("RCMT", "year", "2025-12", 290_000_000),
    stream("SPCB", "quarter", "2026-09", 8_000_000, { value: 30_000_000, formula: "FY 2025-12 + 3 months to 2026-03 + 3 months to 2026-06 + 3 months to 2026-09 - 3 months to 2025-03 - 3 months to 2025-06 - 3 months to 2025-09" }),
    ...["2025-12", "2026-03", "2026-06", "2026-09"].map((pe) => stream("MX", "quarter", pe, 50_000_000)),
  ]);
}

describe("operating KPIs", () => {
  it("keeps a figure only when it is printed in the quoted passage of the document", () => {
    const passages = new Map([[0, htmlText(RCMT_10K)]]);
    const checked = verifyItems(answers["10-K annual report"], passages);
    expect(checked.map((i) => i.inText)).toEqual([true, true, false, false]);
    // The XBRL header is hidden text, never a passage: a figure printed only there is dropped too.
    expect(htmlText(RCMT_10K)).not.toContain("999,999");
    expect(verifyItems([item({ printed: "999,999", periodEnd: "2025-12", quote: "backlog 999,999" })], passages)[0].inText).toBe(false);
    const readings = kpiReadings({ version: KPI_EXTRACT_VERSION, reads: [{ version: KPI_EXTRACT_VERSION, document: { title: "10-K", url: "u", registry: "sec", form: "10-K", filedAt: "2026-02-01" }, passages: 1, items: checked, model: "fake" }] });
    expect(readings.map((r) => `${r.kpi} ${r.periodEnd} ${r.value}`)).toEqual(["backlog 2025-12 310500000", "backlog 2024-12 195000000"]);
  });

  it("stores backlog per period with its source passage and its ratio to revenue for RCMT, SPCB and MX", async () => {
    await seed();
    const report = await runDimension(db, dim, { trigger: "test", ctx });
    expect(report.status).toBe("succeeded");
    // One read per periodic report or earnings release; the Form 4 is never read.
    expect(prompts).toHaveLength(3);
    // The 8-K is read through its EX-99.1 earnings release.
    expect(prompts.find((p) => p.includes("8-K"))).toContain("Backlog reached $62.4 million");

    const rows = await db.select().from(goldOperatingKpis);
    const backlog = (s: string, pe: string) => rows.find((r) => r.symbol === s && r.kpi === "backlog" && r.periodEnd === pe)!;
    expect(rows.filter((r) => r.kpi === "backlog").map((r) => `${r.symbol} ${r.periodEnd}`).sort()).toEqual(["MX 2026-09", "RCMT 2024-12", "RCMT 2025-12", "SPCB 2025-09", "SPCB 2026-09"]);
    // Dropped: the order intake the 10-K never printed, the 2023 backlog absent from its quote.
    expect(rows.some((r) => r.kpi === "order-intake" || r.periodEnd === "2023-12")).toBe(false);

    const rcmt = backlog("RCMT", "2025-12");
    expect(rcmt).toMatchObject({ value: 310_500_000, unit: "currency", currency: "USD", priorValue: 195_000_000, revenue: 290_000_000, revenueBasis: "FY 2025-12 revenue", sources: ["sec"] });
    expect(rcmt.growth).toBeCloseTo(310.5 / 195 - 1, 9);
    expect(rcmt.revenueRatio).toBeCloseTo(310.5 / 290, 9);
    expect(rcmt.citation).toMatchObject({ document: "10-K annual report", printed: "$310.5", quote: expect.stringContaining("our backlog was $310.5 million") });

    const spcb = backlog("SPCB", "2026-09");
    expect(spcb.revenueRatio).toBeCloseTo(62.4 / 30, 9);
    expect(spcb.revenueBasis).toMatch(/^LTM revenue to 2026-09 = FY 2025-12/);
    expect(spcb.growth).toBeCloseTo(62.4 / 28 - 1, 9);

    const mx = backlog("MX", "2026-09");
    expect(mx.revenueRatio).toBeCloseTo(45 / 200, 9);
    expect(mx.revenueBasis).toBe("LTM revenue to 2026-09 = 4 quarters to 2026-09");
    expect(rows.find((r) => r.symbol === "MX" && r.kpi === "book-to-bill")).toMatchObject({ unit: "multiple", value: 1.3, periodType: "quarter", revenueRatio: null });

    // Silver keeps every document that printed a period.
    expect((await db.select().from(operatingKpis)).find((r) => r.symbol === "RCMT" && r.periodEnd === "2025-12")!.observations).toHaveLength(1);
  });

  it("reads each document once: a later run reuses the reads, no LLM call", async () => {
    await seed();
    await runDimension(db, dim, { trigger: "test", ctx });
    const again = await filingDocuments.fetch("RCMT", { ...ctx, db, complete: async () => { throw new Error("no LLM call: the read is reused"); } });
    expect(again.error).toBeUndefined();
    expect((again.request as { reused: string[] }).reused).toEqual([FILINGS[0].url]);
  });

  it("hands the KPIs to the analysis, the evidence judge and the state judges, and charts them", async () => {
    await seed();
    await runDimension(db, dim, { trigger: "test", ctx });
    const figures = await figuresText(db, "RCMT");
    expect(figures).toContain("Operating KPIs the company reports");
    expect(figures).toContain("- Backlog [kpi:backlog]: at 2024-12 195.0M USD (0.72x FY 2024-12 revenue) | at 2025-12 310.5M USD (+59.2%, 1.07x FY 2025-12 revenue)");
    expect(figures).toContain('Latest printed in 10-K annual report');
    const facts = await gatherFacts(db, "RCMT");
    expect(facts.text).toContain("- Backlog [kpi:backlog]");
    // Evidence reads the same figures block (narrative-state reads figuresText too).
    const d = { side: "long" as const, version: "v", narrative: "The market sees a staffing firm in decline.", gapPct: null, market: null, drivers: [{ rank: 1, category: "Business economics", title: "Demand is shrinking", text: "Revenue fell." }] };
    expect(batchPrompt("RCMT", d as never, [], new Map(), figures)).toContain("at 2025-12 310.5M USD");
    const catalog = await seriesCatalog(db, "RCMT");
    expect(catalog.get("kpi:backlog")).toMatchObject({ label: "Backlog (at period end)", unit: "currency", currency: "USD" });
    expect(catalog.get("kpi-ratio:backlog")?.points.get("2025-12")).toBeCloseTo(310.5 / 290, 9);
  });

  it("takes the revenue a KPI compares to from the same period, or the last 12 months for a balance", () => {
    const streams = [stream("X", "year", "2025-12", 100), stream("X", "half", "2026-06", 60, { value: 110, formula: "FY 2025-12 + 6 months to 2026-06 - 6 months to 2025-06" })];
    expect(revenueFor(streams, "instant", "2025-12")).toMatchObject({ value: 100, basis: "FY 2025-12 revenue" });
    expect(revenueFor(streams, "instant", "2026-06")).toMatchObject({ value: 110 });
    expect(revenueFor(streams, "half", "2026-06")).toMatchObject({ value: 60, basis: "6 months to 2026-06 revenue" });
    expect(revenueFor(streams, "instant", "2026-03")).toBeNull();
  });
});
