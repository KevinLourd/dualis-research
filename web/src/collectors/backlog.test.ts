import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { financialMetrics, goldFinancialLines } from "@/db/schema/financials";
import { runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { figuresText, gatherFacts } from "./dimensions/analysis/facts";
import { seriesCatalog } from "./dimensions/analysis/series";
import { batchPrompt } from "./dimensions/evidence";
import { promoteFinancials } from "./dimensions/financials";
import { deriveMetrics } from "./dimensions/financials/derive";
import { inlineXbrlFacts, operatingFromFilings, pdfExtract, PDF_EXTRACT_VERSION, pickPages, type SecFilingDoc } from "./dimensions/financials/sources";

/**
 * Backlog, remaining performance obligations and order intake: more canonical financial lines, read by the same
 * sources (the filings' inline XBRL, the report PDFs), stored with the same provenance. The figures below are
 * invented for the test; production reads each company's own filings.
 */
const context = (id: string, date: string, opts: { start?: string; member?: string } = {}) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${opts.member ? `<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionStartDateAxis">${opts.member}</xbrldi:explicitMember></xbrli:segment>` : ""}</xbrli:entity><xbrli:period>${opts.start ? `<xbrli:startDate>${opts.start}</xbrli:startDate><xbrli:endDate>${date}</xbrli:endDate>` : `<xbrli:instant>${date}</xbrli:instant>`}</xbrli:period></xbrli:context>`;
const fact = (name: string, ctx: string, shown: string, scale = 6) => `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="usd" scale="${scale}" decimals="-5">${shown}</ix:nonFraction>`;
const filing = (accession: string, form: string, reportDate: string, html: string): SecFilingDoc => ({ accession, form, reportDate, url: `https://sec/${accession}.htm`, facts: inlineXbrlFacts(html), factsVersion: 3 });

/** RCM Technologies tags its backlog under its own element; SuperCom and Magnachip report RPO (ASC 606). */
const RCMT = [
  filing("r1", "10-K", "2024-12-28", `${context("i24", "2024-12-28")}<p>Backlog ${fact("rcmt:Backlog", "i24", "195.0")}</p>`),
  filing("r2", "10-K", "2025-12-27", `${context("i25", "2025-12-27")}${context("i24", "2024-12-28")}<p>Backlog ${fact("rcmt:Backlog", "i25", "310.5")} vs ${fact("rcmt:Backlog", "i24", "195.0")}</p>`),
];
const SPCB = [
  filing("s1", "10-K", "2025-12-31", `${context("c25", "2025-12-31")}${context("t25", "2025-12-31", { member: "spcb:NextTwelveMonthsMember" })}<p>RPO ${fact("us-gaap:RevenueRemainingPerformanceObligation", "c25", "52.0")}, of which ${fact("us-gaap:RevenueRemainingPerformanceObligation", "t25", "20.0")} within a year</p>`),
  filing("s2", "10-K", "2024-12-31", `${context("c24", "2024-12-31")}<p>RPO ${fact("us-gaap:RevenueRemainingPerformanceObligation", "c24", "26.0")}</p>`),
];
const MX = [
  filing("m1", "10-Q", "2026-09-30", `${context("q", "2026-09-30")}${context("d", "2026-09-30", { start: "2026-07-01" })}<p>RPO ${fact("us-gaap:RevenueRemainingPerformanceObligation", "q", "45.0")}; bookings ${fact("mx:Bookings", "d", "65.0")}</p>`),
  filing("m0", "10-K", "2025-12-31", `<p>annual</p>`),
];

/** Revenue from SEC company facts, the same shape the `sec` source stores. */
const companyFacts = (rows: { start: string; end: string; val: number; form: string }[]) => ({ cik: 1, entityName: "x", facts: { "us-gaap": { Revenues: { units: { USD: rows.map((r) => ({ ...r, filed: "2026-11-01", fp: r.form === "10-K" ? "FY" : "Q3" })) } } } } });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

async function promote() {
  const [run] = await db.insert(runs).values({ dimension: "financials", trigger: "test" }).returning({ id: runs.id });
  const row = (source: string, subject: string, payload: unknown) => ({ runId: run.id, dimension: "financials", source, subject, request: {}, httpStatus: 200, payload });
  await db.insert(fetches).values([
    row("sec-filings", "RCMT", { cik: "1", documents: RCMT }),
    row("sec", "RCMT", companyFacts([{ start: "2024-12-29", end: "2025-12-27", val: 290e6, form: "10-K" }, { start: "2023-12-31", end: "2024-12-28", val: 270e6, form: "10-K" }])),
    row("sec-filings", "SPCB", { cik: "2", documents: SPCB }),
    row("sec", "SPCB", companyFacts([{ start: "2025-01-01", end: "2025-12-31", val: 26e6, form: "10-K" }])),
    row("sec-filings", "MX", { cik: "3", documents: MX }),
    row("sec", "MX", companyFacts(["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].map((end) => ({ start: `${end.slice(0, 5)}${String(Number(end.slice(5, 7)) - 2).padStart(2, "0")}-01`, end, val: 50e6, form: "10-Q" })))),
  ]);
  await promoteFinancials(db, await db.select().from(fetches));
}

describe("backlog and contracted revenue as financial lines", () => {
  it("reads the company total from the filings' XBRL: never a timing slice, a balance at a date, bookings over the quarter", () => {
    expect(operatingFromFilings(SPCB).map((r) => `${r.line} ${r.periodType} ${r.periodEnd} ${r.value}`).sort()).toEqual([
      "remaining-performance-obligations year 2024-12 26000000",
      "remaining-performance-obligations year 2025-12 52000000",
    ]);
    expect(operatingFromFilings(MX).map((r) => `${r.line} ${r.periodType} ${r.periodEnd} ${r.value}`).sort()).toEqual([
      "order-intake quarter 2026-09 65000000",
      "remaining-performance-obligations quarter 2026-09 45000000",
    ]);
  });

  it("stores backlog per period for RCMT, SPCB and MX with its source, and its ratio to the last 12 months of revenue", async () => {
    await promote();
    const lines = await db.select().from(goldFinancialLines);
    const metrics = await db.select().from(financialMetrics);
    const line = (s: string, l: string, pe: string) => lines.find((x) => x.symbol === s && x.line === l && x.periodEnd === pe);
    const metric = (s: string, m: string, pe: string) => metrics.find((x) => x.symbol === s && x.metric === m && x.periodEnd === pe);
    expect(line("RCMT", "backlog", "2025-12")).toMatchObject({ statement: "operating", periodType: "year", value: 310_500_000, sources: ["sec-filings"], label: "rcmt:Backlog (10-K 2025-12-27)" });
    expect(metric("RCMT", "backlog-to-revenue", "2025-12")!.value).toBeCloseTo(310.5 / 290, 9);
    expect(metric("RCMT", "backlog-to-revenue", "2025-12")!.formula).toBe("backlog / fiscal year revenue");
    expect(metric("RCMT", "backlog-growth", "2025-12")!.value).toBeCloseTo(310.5 / 195 - 1, 9);
    expect(line("SPCB", "remaining-performance-obligations", "2025-12")!.value).toBe(52_000_000);
    expect(metric("SPCB", "remaining-performance-obligations-to-revenue", "2025-12")!.value).toBeCloseTo(2, 9);
    expect(metric("MX", "remaining-performance-obligations-to-revenue", "2026-09")).toMatchObject({ periodType: "quarter", unit: "multiple", formula: "remaining performance obligations / revenue of the last 4 reported quarters" });
    expect(metric("MX", "remaining-performance-obligations-to-revenue", "2026-09")!.value).toBeCloseTo(45 / 200, 9);
    expect(metric("MX", "book-to-bill", "2026-09")!.value).toBeCloseTo(1.3, 9);
  });

  it("hands the order book to the analysis, the evidence judge and the state judges, and charts it", async () => {
    await promote();
    const figures = await figuresText(db, "RCMT");
    expect(figures).toContain("Operating figures the company reports");
    expect(figures).toMatch(/Backlog \(order book\) as the company reports it \[line:backlog\] \| 195\.0M \| 310\.5M/);
    expect(figures).toMatch(/Backlog \/ last 12 months revenue \[metric:backlog-to-revenue\] \| 0\.7x \| 1\.1x/);
    expect((await figuresText(db, "MX"))).toContain("[qmetric:book-to-bill]");
    expect((await gatherFacts(db, "RCMT")).text).toContain("[line:backlog]");
    const d = { side: "long" as const, version: "v", narrative: "The market sees a staffing firm in decline.", gapPct: null, market: null, drivers: [{ rank: 1, category: "Business economics", title: "Demand is shrinking", text: "Revenue fell." }] };
    expect(batchPrompt("RCMT", d as never, [], new Map(), figures)).toContain("[line:backlog]");
    expect((await seriesCatalog(db, "RCMT")).get("metric:backlog-to-revenue")).toMatchObject({ label: "Backlog / last 12 months revenue", unit: "multiple" });
  });

  it("a ticker that reports no order book adds nothing to what the judges read", async () => {
    await promote();
    const metrics = deriveMetrics("X", [{ periodType: "year", periodEnd: "2025-12", line: "revenue", value: 100, currency: "USD", sources: ["sec"] }]);
    expect(metrics.some((m) => m.metric.includes("backlog") || m.metric === "book-to-bill")).toBe(false);
    expect(await figuresText(db, "NOPE")).not.toContain("Operating figures");
  });
});

describe("report PDFs", () => {
  it("reads the order book page, and drops a backlog figure not printed on the page it cites", () => {
    const pages = ["Contents", "Consolidated Statement of Profit or Loss\nRevenue 808,417", "Business review\nThe order backlog stood at HK$1,234.5 million at 31 March 2026."];
    expect(pickPages(pages).map((p) => p.page)).toEqual([2, 3]);
    const payload = {
      version: PDF_EXTRACT_VERSION,
      documents: [
        {
          kind: "interim",
          version: PDF_EXTRACT_VERSION,
          document: { title: "Interim Report 2026", url: "https://h/ir.pdf", filedAt: "2026-05-29" },
          pages: [{ page: 3, text: pages[2] }],
          extraction: {
            currency: "HKD",
            periods: [
              { periodEnd: "2026-03", months: 6, lines: [{ line: "backlog", printed: "1,234.5", unit: "million", page: 3, label: "Order backlog" }] },
              // Invented: never printed on page 3.
              { periodEnd: "2025-03", months: 6, lines: [{ line: "backlog", printed: "999.9", unit: "million", page: 3, label: "Order backlog" }] },
            ],
          },
          model: "m",
        },
      ],
    };
    const out = pdfExtract.extract(payload);
    expect(out.map((r) => `${r.line} ${r.periodType} ${r.periodEnd} ${r.value}`)).toEqual(["backlog half 2026-03 1234500000"]);
    expect(out[0].citation).toMatchObject({ page: 3, quote: "1,234.5" });
  });
});
