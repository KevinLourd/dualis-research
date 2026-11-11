import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fetches } from "@/db/schema/bronze";
import { runs } from "@/db/schema/ops";
import type { GoldRevenueStream } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { figuresText, streamsText } from "./dimensions/analysis/facts";
import { batchPrompt } from "./dimensions/evidence";
import { revenueStreams } from "@/db/schema/financials";
import { seriesCatalog } from "./dimensions/analysis/series";
import { goldFinancialLines } from "@/db/schema/financials";
import { latestReports, inlineXbrlFacts, pdfExtract, PDF_EXTRACT_VERSION, pickPages, segmentsFromFilings } from "./dimensions/financials/sources";
import { deriveRevenueStreams } from "./dimensions/financials/streams";
import type { SourceContext } from "./types";

/** Water Oasis (1161.HK), fiscal year to September: the 2025 annual report and the interim report to March 2026. */
const l = (periodType: "year" | "half" | "quarter", periodEnd: string, line: string, value: number) => ({ periodType, periodEnd, line, value, currency: "HKD", sources: ["pdf-extract"], citation: null });
const SVC = "segment:product:Provision of treatment services";
const SKIN = "segment:product:Sales of skincare products";
const WATER_OASIS = [
  l("year", "2024-09", "revenue", 983_215_000),
  l("year", "2025-09", "revenue", 981_334_000),
  l("year", "2024-09", SVC, 853_144_000),
  l("year", "2025-09", SVC, 886_620_000),
  l("year", "2024-09", SKIN, 130_071_000),
  l("year", "2025-09", SKIN, 94_714_000),
  l("half", "2025-03", "revenue", 492_241_000),
  l("half", "2026-03", "revenue", 515_794_000),
  l("half", "2025-03", SVC, 432_302_000),
  l("half", "2026-03", SVC, 473_630_000),
  l("half", "2025-03", SKIN, 59_939_000),
  l("half", "2026-03", SKIN, 42_164_000),
];

describe("revenue streams", () => {
  it("measures each stream against the same period a year earlier, its share of total, and the last 12 months", () => {
    const rows = deriveRevenueStreams("1161.HK", WATER_OASIS);
    const svcH1 = rows.find((r) => r.line === SVC && r.periodType === "half" && r.periodEnd === "2026-03")!;
    expect(svcH1).toMatchObject({ axis: "product", name: "Provision of treatment services", priorValue: 432_302_000 });
    expect(svcH1.growth).toBeCloseTo(473_630 / 432_302 - 1, 9);
    expect(svcH1.shareOfTotal).toBeCloseTo(473_630 / 515_794, 9);
    expect(svcH1.axisCoverage).toBeCloseTo(1, 9);
    // LTM = FY 2025-09 + 6 months to 2026-03 - 6 months to 2025-03.
    expect(svcH1.ltmValue).toBe(886_620_000 + 473_630_000 - 432_302_000);
    expect(svcH1.ltmFormula).toBe("FY 2025-09 + 6 months to 2026-03 - 6 months to 2025-03");
    // No interim report a year earlier: the LTM a year earlier is unknown, never guessed.
    expect(svcH1.ltmGrowth).toBeNull();
    const total = rows.find((r) => r.line === "revenue" && r.periodType === "year" && r.periodEnd === "2025-09")!;
    expect(total).toMatchObject({ axis: "total", name: "Total revenue", shareOfTotal: null, axisCoverage: null, ltmValue: null });
    expect(total.growth).toBeCloseTo(981_334 / 983_215 - 1, 9);
  });

  it("builds a quarterly LTM only when every quarter since the fiscal year and its year-earlier twin was published", () => {
    const q = (pe: string, v: number) => l("quarter", pe, "revenue", v);
    const full = deriveRevenueStreams("X", [l("year", "2024-12", "revenue", 400), l("year", "2025-12", "revenue", 440), q("2025-03", 100), q("2025-06", 100), q("2026-03", 120), q("2026-06", 130)]);
    const jun = full.find((r) => r.periodType === "quarter" && r.periodEnd === "2026-06")!;
    expect(jun.ltmValue).toBe(440 + 120 + 130 - 100 - 100);
    expect(jun.ltmFormula).toBe("FY 2025-12 + 3 months to 2026-03 + 3 months to 2026-06 - 3 months to 2025-03 - 3 months to 2025-06");
    const gap = deriveRevenueStreams("X", [l("year", "2025-12", "revenue", 440), q("2025-06", 100), q("2026-03", 120), q("2026-06", 130)]);
    expect(gap.find((r) => r.periodEnd === "2026-06")!.ltmValue).toBeNull();
  });

  it("hands the model every stream with its growth and LTM, the total first, and says how much of the total an axis covers", () => {
    const rows = deriveRevenueStreams("1161.HK", WATER_OASIS).map((r) => ({ ...r, rebuiltAt: new Date() })) as GoldRevenueStream[];
    const text = streamsText(rows)!;
    const lines = text.split("\n");
    // The interim period and its year-earlier twin both show: the model sees what the growth compares.
    expect(lines[1]).toBe("- Total revenue: FY 2024-09 983.2M | FY 2025-09 981.3M (-0.2%) | 6 months to 2025-03 492.2M | 6 months to 2026-03 515.8M (+4.8%); LTM 1.00B = FY 2025-09 + 6 months to 2026-03 - 6 months to 2025-03");
    expect(lines[2]).toMatch(/^- product: Provision of treatment services: .*6 months to 2026-03 473\.6M \(\+9\.6%, 92% of total\)/);
    expect(lines[3]).toMatch(/^- product: Sales of skincare products: .*\(-29\.7%, 8% of total\)/);
    expect(text).toContain("Coverage: product streams add up to 100% of total revenue (6 months to 2026-03).");
    expect(streamsText([])).toBeNull();
  });
});

/** A 10-Q: one quarter, the 6-month year to date (skipped), a two-axis fact (skipped), a restated quarter in a later 10-Q. */
const ctxXml = (id: string, axis: string | null, member: string | null, start: string, end: string) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${axis ? `<xbrli:segment><xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember></xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const fact = (name: string, ctx: string, v: string) => `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="USD" scale="3">${v}</ix:nonFraction>`;
const TEN_Q = [
  ctxXml("q", "srt:ProductOrServiceAxis", "acme:ElectronicMonitoringMember", "2026-04-01", "2026-06-30"),
  ctxXml("ytd", "srt:ProductOrServiceAxis", "acme:ElectronicMonitoringMember", "2026-01-01", "2026-06-30"),
  ctxXml("geo", "srt:StatementGeographicalAxis", "country:US", "2026-04-01", "2026-06-30"),
  `<xbrli:context id="two"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:ElectronicMonitoringMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>`,
  fact("us-gaap:Revenues", "q", "7,100"),
  fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "q", "7,000"),
  fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "ytd", "13,900"),
  fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "geo", "5,000"),
  fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "two", "4,000"),
].join("\n");

describe("SEC revenue per segment", () => {
  it("keeps a quarter or a year on one axis, the preferred tag, the latest filing's figure", () => {
    const facts = inlineXbrlFacts(TEN_Q);
    expect(facts.filter((f) => f.axes).map((f) => f.value).sort((a, b) => a - b)).toEqual([5_000_000, 7_000_000, 7_100_000, 13_900_000]);
    const doc = (accession: string, reportDate: string, html: string) => ({ accession, form: "10-Q", reportDate, url: "x", facts: inlineXbrlFacts(html), factsVersion: 2 });
    const restated = TEN_Q.replace(">7,000<", ">7,050<");
    const r = segmentsFromFilings([doc("2", "2026-09-30", restated), doc("1", "2026-06-30", TEN_Q)]);
    expect(r.map((x) => [x.periodType, x.periodEnd, x.line, x.value]).sort()).toEqual([
      ["quarter", "2026-06", "segment:product:Electronic Monitoring", 7_050_000],
      ["quarter", "2026-06", "segment:region:US", 5_000_000],
    ]);
  });
});

describe("Hong Kong reports", () => {
  it("finds a segment note that opens mid-page and a statement title wrapped over two lines", () => {
    const pages = ["Contents", "Condensed Consolidated Statement of Profit or\nLoss ... six months ended 31 March 2026", "(continued)", "x", "3. ACCOUNTING POLICIES ... 5. REVENUE AND SEGMENT INFORMATION Revenue recognised during the period", "5. REVENUE AND SEGMENT INFORMATION (Continued)", "6. OTHER EXPENSES"];
    expect(pickPages(pages).map((p) => p.page)).toEqual([2, 3, 5, 6, 7]);
  });

  it("reads an interim report's six-month columns as half years, an annual report's as fiscal years", () => {
    const read = (kind: "annual" | "interim", text: string, extraction: unknown) => ({ kind, version: PDF_EXTRACT_VERSION, document: { title: kind, url: `https://x/${kind}.pdf`, filedAt: "2026-05-29T00:00:00Z" }, pages: [{ page: 16, text }], extraction, model: "m" });
    const payload = {
      version: PDF_EXTRACT_VERSION,
      documents: [
        read("annual", "Revenue 981,334 983,215", { currency: "HKD", periods: [{ periodEnd: "2025-09", lines: [{ line: "revenue", printed: "981,334", unit: "thousand", page: 16, label: "Revenue" }] }] }),
        read("interim", "Total 42,164 59,939 473,630 432,302 515,794 492,241 Cash 746,512", {
          currency: "HKD",
          periods: [
            { periodEnd: "2026-03", months: 6, lines: [{ line: "revenue", printed: "515,794", unit: "thousand", page: 16, label: "Total" }] },
            { periodEnd: "2025-03", months: 6, lines: [{ line: "revenue", printed: "492,241", unit: "thousand", page: 16, label: "Total" }] },
            { periodEnd: "2025-09", months: 12, lines: [{ line: "cash", printed: "746,512", unit: "thousand", page: 16, label: "Cash" }] },
            { periodEnd: "2026-03", months: 9, lines: [{ line: "net-income", printed: "42,164", unit: "thousand", page: 16, label: "?" }] },
          ],
          segments: [
            { periodEnd: "2026-03", months: 6, axis: "product", name: "Provision of treatment services", printed: "473,630", unit: "thousand", page: 16 },
            { periodEnd: "2025-03", months: 6, axis: "product", name: "Provision of treatment services", printed: "432,302", unit: "thousand", page: 16 },
            { periodEnd: "2026-03", months: 6, axis: "brand", name: "Oasis", printed: "42,164", unit: "thousand", page: 16 },
          ],
        }),
      ],
    };
    const r = pdfExtract.extract(payload).map((x) => [x.periodType, x.periodEnd, x.line, x.value]);
    expect(r.sort()).toEqual(
      [
        ["half", "2025-03", "revenue", 492_241_000],
        ["half", "2025-03", "segment:product:Provision of treatment services", 432_302_000],
        ["half", "2026-03", "revenue", 515_794_000],
        ["half", "2026-03", "segment:product:Provision of treatment services", 473_630_000],
        ["year", "2025-09", "cash", 746_512_000],
        ["year", "2025-09", "revenue", 981_334_000],
      ].sort(),
    );
  });

  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => ({ db, close } = await testDb()));
  afterEach(async () => close());

  const filing = (title: string, filedAt: string, url: string) => ({ id: randomUUID(), symbol: "1161.HK", registry: "hkex", filingKey: url, title, filedAt: new Date(filedAt), url, language: "en", sources: ["hkex"] });

  it("reads the latest annual report and the interim report filed after it, reusing what an earlier run read", async () => {
    await db.insert(gold.filings).values([
      filing("Annual Report 2025", "2025-12-18", "https://h/ar25.pdf"),
      filing("Interim Report 2025", "2025-05-29", "https://h/ir25.pdf"),
      filing("Interim Report 2026", "2026-05-29", "https://h/ir26.pdf"),
      filing("Interim Results Announcement", "2026-05-26", "https://h/ann.pdf"),
    ]);
    const ctx: SourceContext = { env: {}, db, fetch: (async () => { throw new Error("no download: both reads are reused"); }) as unknown as typeof fetch, complete: async () => { throw new Error("no LLM call"); } };
    expect((await latestReports(ctx, "1161.HK")).map((r) => `${r.kind} ${r.doc.url}`)).toEqual(["annual https://h/ar25.pdf", "interim https://h/ir26.pdf"]);
    const read = (kind: string, url: string) => ({ kind, version: PDF_EXTRACT_VERSION, document: { title: kind, url, filedAt: "x" }, pages: [], extraction: {}, model: "m" });
    const [run] = await db.insert(runs).values({ dimension: "financials", trigger: "test" }).returning({ id: runs.id });
    await db.insert(fetches).values({ runId: run.id, dimension: "financials", source: "pdf-extract", subject: "1161.HK", request: {}, httpStatus: 200, payload: { version: PDF_EXTRACT_VERSION, documents: [read("annual", "https://h/ar25.pdf"), read("interim", "https://h/ir26.pdf")] } });
    const out = await pdfExtract.fetch("1161.HK", ctx);
    expect(out.error).toBeUndefined();
    expect((out.request as { reused: string[] }).reused).toEqual(["https://h/ar25.pdf", "https://h/ir26.pdf"]);
  });

  it("hands every judge of the story the reported figures: half years and revenue by stream", async () => {
    const row = (periodType: "year" | "half", periodEnd: string, line: string, value: number) => ({ symbol: "1161.HK", periodType, periodEnd, line, statement: line.startsWith("segment:") ? ("segment" as const) : ("income" as const), value, currency: "HKD", label: line, consolidated: true, sources: ["pdf-extract"], alternatives: [] });
    const lines = WATER_OASIS.map((x) => row(x.periodType as "year" | "half", x.periodEnd, x.line, x.value));
    await db.insert(goldFinancialLines).values(lines);
    await db.insert(revenueStreams).values(deriveRevenueStreams("1161.HK", WATER_OASIS));
    const figures = await figuresText(db, "1161.HK");
    expect(figures).toContain("Revenue (half-yearly) [hline:revenue] | 492.2M | 515.8M");
    expect(figures).toContain("6 months to 2026-03 473.6M (+9.6%, 92% of total)");
    const d = { side: "long" as const, version: "v", narrative: "The market sees a flat chain.", gapPct: null, market: null, drivers: [{ rank: 1, category: "Business economics", title: "Revenue has stopped growing", text: "Flat for two years." }] };
    const prompt = batchPrompt("1161.HK", d as never, [{ kind: "filing", id: "f", title: "Interim Results Announcement", publisher: null, summary: null, url: null, at: new Date("2026-05-26"), sources: ["hkex"] }], new Map(), figures);
    expect(prompt.indexOf("6 months to 2026-03 473.6M")).toBeGreaterThan(prompt.indexOf("Revenue has stopped growing"));
    expect(prompt.indexOf("6 months to 2026-03 473.6M")).toBeLessThan(prompt.indexOf("Interim Results Announcement"));
  });

  it("charts half years apart from quarters", async () => {
    await db.insert(goldFinancialLines).values([
      { symbol: "1161.HK", periodType: "half", periodEnd: "2026-03", line: "revenue", statement: "income", value: 515_794_000, currency: "HKD", label: "Revenue", consolidated: true, sources: ["pdf-extract"], alternatives: [] },
      { symbol: "1161.HK", periodType: "half", periodEnd: "2025-03", line: "revenue", statement: "income", value: 492_241_000, currency: "HKD", label: "Revenue", consolidated: true, sources: ["pdf-extract"], alternatives: [] },
    ]);
    const catalog = await seriesCatalog(db, "1161.HK");
    expect(catalog.get("hline:revenue")).toMatchObject({ label: "Revenue (half-yearly)", periodType: "half" });
    expect(catalog.has("qline:revenue")).toBe(false);
  });
});
