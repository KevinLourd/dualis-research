import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { financialLines, financialMetrics, goldFinancialLines, valuations } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { financials } from "./dimensions/financials";
import { deriveMetrics } from "./dimensions/financials/derive";
import { lineConsensus } from "./dimensions/financials/merge";
import { dueFiscalYearEnds, edinetFinancials, fourthQuarters, edinetRows, parsePrinted, pdfExtract, pickPages } from "./dimensions/financials/sources";
import { unzip } from "./dimensions/financials/zip";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const usd = (start: string | undefined, end: string, val: number, extra: Record<string, string> = {}) => ({ start, end, val, fp: "FY", form: "10-K", filed: "2026-05-20", accn: "0001", ...extra });
const SEC_FACTS = {
  cik: 1,
  entityName: "Monro, Inc.",
  facts: {
    "us-gaap": {
      Revenues: { label: "Revenues", units: { USD: [usd("2024-03-31", "2025-03-29", 1_200_000_000), usd("2025-03-30", "2026-03-28", 1_150_000_000), usd("2025-09-28", "2026-03-28", 580_000_000, { fp: "Q4", form: "10-K" })] } },
      OperatingIncomeLoss: { label: "Operating income", units: { USD: [usd("2024-03-31", "2025-03-29", 60_000_000), usd("2025-03-30", "2026-03-28", 40_000_000)] } },
      DepreciationDepletionAndAmortization: { label: "D&A", units: { USD: [usd("2024-03-31", "2025-03-29", 70_000_000), usd("2025-03-30", "2026-03-28", 65_000_000)] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [usd("2025-03-30", "2026-03-28", 90_000_000)] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [usd("2025-03-30", "2026-03-28", 25_000_000)] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [usd(undefined, "2025-03-29", 10_000_000), usd(undefined, "2026-03-28", 20_000_000)] } },
      LongTermDebtNoncurrent: { units: { USD: [usd(undefined, "2025-03-29", 100_000_000), usd(undefined, "2026-03-28", 80_000_000)] } },
      // A quarterly report: a 3-month quarter is read, the year-to-date half is not.
      NetIncomeLoss: { units: { USD: [usd("2026-03-29", "2026-06-27", 5_000_000, { fp: "Q1", form: "10-Q" }), usd("2026-03-29", "2026-09-27", 3_000_000, { fp: "Q2", form: "10-Q" })] } },
      SomeTagWeDoNotRead: { units: { USD: [usd("2025-03-30", "2026-03-28", 1)] } },
    },
  },
};

const ts = (date: string) => Math.floor(Date.parse(`${date}T14:30:00Z`) / 1000);
const timeseries = (rows: [string, string, number][]) =>
  json({ timeseries: { result: rows.map(([type, date, v]) => ({ meta: { symbol: ["MNRO"], type: [type] }, [type]: [{ asOfDate: date, currencyCode: "USD", reportedValue: { raw: v } }] })) } });

let yahooDown = false;
const dartRow = (sj_div: string, account_id: string, account_nm: string, amount: string) => ({ sj_div, account_id, account_nm, thstrm_amount: amount, currency: "KRW", frmtrm_amount: "1" });
const fake = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const path = url.pathname;
  if (url.host === "www.sec.gov" && path === "/files/company_tickers.json") return json({ 0: { cik_str: 1, ticker: "MNRO" } });
  if (url.host === "data.sec.gov") return path.endsWith("CIK0000000001.json") ? json(SEC_FACTS) : new Response("no", { status: 404 });
  if (path.startsWith("/ws/fundamentals-timeseries/")) {
    if (yahooDown) return new Response("Too Many Requests", { status: 429 });
    if (!path.endsWith("/MNRO")) return json({ timeseries: { result: [] } });
    return timeseries([
      ["annualTotalRevenue", "2026-03-31", 1_150_000_000], // same as SEC
      ["annualTotalRevenue", "2025-03-31", 1_201_000_000], // within 0.5% of SEC: same figure
      ["annualOperatingIncome", "2026-03-31", 44_000_000], // 10% off SEC: an alternative
      ["annualOrdinarySharesNumber", "2026-03-31", 30_000_000],
      ["annualOrdinarySharesNumber", "2025-03-31", 31_000_000],
      ["annualCapitalExpenditure", "2026-03-31", -25_000_000], // Yahoo signs outflows negative
    ]);
  }
  if (path.startsWith("/v8/finance/chart/")) {
    if (!path.endsWith("/MNRO")) return json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
    return json({ chart: { result: [{ meta: { currency: "USD", gmtoffset: -14400 }, timestamp: [ts("2025-03-03"), ts("2026-03-02")], indicators: { quote: [{ close: [30, 20] }] } }] } });
  }
  if (url.host === "opendart.fss.or.kr") {
    const year = url.searchParams.get("bsns_year");
    const rc = url.searchParams.get("reprt_code");
    if (url.searchParams.get("corp_code") === "00000000" || !(year === "2025" && rc === "11011" && url.searchParams.get("fs_div") === "CFS")) return json({ status: "013", message: "조회된 데이타가 없습니다." });
    return json({
      status: "000",
      list: [
        dartRow("CIS", "ifrs-full_Revenue", "매출액", "291764969976"),
        dartRow("CIS", "dart_OperatingIncomeLoss", "영업이익", "58544362713"),
        dartRow("CIS", "ifrs-full_ProfitLossAttributableToOwnersOfParent", "지배기업의 소유주에 귀속될 당기순이익", "40972466221"),
        dartRow("BS", "ifrs-full_CashAndCashEquivalents", "현금및현금성자산", "143193153018"),
        dartRow("BS", "ifrs-full_Liabilities", "부채총계", "84000000000"),
        dartRow("BS", "ifrs-full_ShorttermBorrowings", "단기차입금", "20705000000"),
        dartRow("BS", "dart_LongTermBorrowingsGross", "장기차입금", "11250000000"),
        dartRow("CF", "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "유형자산의 취득", "5830719078"),
      ],
    });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const ctx = (): SourceContext => ({ env: { REPO_ROOT, DART_API_KEY: "secret-dart-key" }, fetch: fake });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  yahooDown = false;
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await analyseEveryTicker(db);
  await db.insert(gold.quotes).values({ symbol: "MNRO", date: "2026-11-04", close: 25, currency: "USD", sources: ["nasdaq"] });
});
afterEach(async () => close());

const line = async (symbol: string, periodType: string, periodEnd: string, l: string) =>
  (await db.select().from(goldFinancialLines).where(and(eq(goldFinancialLines.symbol, symbol), eq(goldFinancialLines.periodType, periodType as "year"), eq(goldFinancialLines.periodEnd, periodEnd), eq(goldFinancialLines.line, l))))[0];
const metric = async (symbol: string, periodEnd: string, m: string) =>
  (await db.select().from(financialMetrics).where(and(eq(financialMetrics.symbol, symbol), eq(financialMetrics.periodType, "year"), eq(financialMetrics.periodEnd, periodEnd), eq(financialMetrics.metric, m))))[0];

describe("financials dimension", () => {
  it("keeps one line per period, every agreeing source tagged, a disagreeing one as an alternative", async () => {
    await runDimension(db, financials, { trigger: "test", ctx: ctx() });
    expect(await line("MNRO", "year", "2026-03", "revenue")).toMatchObject({ value: 1_150_000_000, sources: ["sec", "yahoo"], statement: "income", currency: "USD" });
    expect((await line("MNRO", "year", "2025-03", "revenue")).sources).toEqual(["sec", "yahoo"]);
    // One source each: the registry (SEC) is shown, Yahoo's figure is the alternative.
    expect(await line("MNRO", "year", "2026-03", "operating-income")).toMatchObject({ value: 40_000_000, sources: ["sec"], alternatives: [{ source: "yahoo", value: 44_000_000 }] });
    // Outflows are positive whatever the source's sign: SEC and Yahoo agree on capex.
    expect(await line("MNRO", "year", "2026-03", "capex")).toMatchObject({ value: 25_000_000, sources: ["sec", "yahoo"] });
    // A 3-month quarter from a 10-Q is read; the 6-month year-to-date figure is not.
    expect(await line("MNRO", "quarter", "2026-06", "net-income")).toMatchObject({ value: 5_000_000 });
    expect(await line("MNRO", "quarter", "2026-09", "net-income")).toBeUndefined();
    expect(await line("MNRO", "year", "2026-03", "total-debt")).toMatchObject({ value: 80_000_000, label: "sum of LongTermDebtNoncurrent" });
    expect(await line("MNRO", "month", "2026-03", "share-price")).toMatchObject({ value: 20, statement: "market" });
  });

  it("derives EBITDA, FCF, net debt, EV/EBITDA per fiscal year from published lines only, with the formula", async () => {
    await runDimension(db, financials, { trigger: "test", ctx: ctx() });
    expect(await metric("MNRO", "2026-03", "ebitda")).toMatchObject({ value: 105_000_000, unit: "currency", formula: "operating income + depreciation and amortization" });
    expect(await metric("MNRO", "2026-03", "fcf")).toMatchObject({ value: 65_000_000 });
    expect(await metric("MNRO", "2026-03", "net-debt")).toMatchObject({ value: 60_000_000 });
    // EV = 20 x 30M + 60M = 660M; / 105M.
    expect((await metric("MNRO", "2026-03", "ev-ebitda")).value).toBeCloseTo(660 / 105, 6);
    // FY2025: EV = 30 x 31M + 90M = 1,020M; EBITDA 130M.
    expect((await metric("MNRO", "2025-03", "ev-ebitda")).value).toBeCloseTo(1020 / 130, 6);
    expect((await metric("MNRO", "2026-03", "revenue-growth")).value).toBeCloseTo(1150 / 1200 - 1, 6);
    // No D&A, no EBITDA: never filled in.
    expect(await metric("101160.KQ", "2025-12", "ebitda")).toBeUndefined();

    const [v] = await db.select().from(valuations).where(eq(valuations.symbol, "MNRO"));
    expect(v).toMatchObject({ currency: "USD", lastFiscalYear: "2026-03", yearsCovered: 2, evEbitdaYears: ["2025-03", "2026-03"], quote: 25, sharesOutstanding: 30_000_000, netDebt: 60_000_000, ebitda: 105_000_000, ebitdaBasis: "fiscal year 2026-03" });
    expect(v.evEbitdaMedian).toBeCloseTo((660 / 105 + 1020 / 130) / 2, 6);
    expect(v.evEbitda).toBeCloseTo((25 * 30_000_000 + 60_000_000) / 105_000_000, 6);
  });

  it("reads Korean statements from DART: borrowings summed into debt, the key never stored", async () => {
    await runDimension(db, financials, { trigger: "test", ctx: ctx() });
    expect(await line("101160.KQ", "year", "2025-12", "revenue")).toMatchObject({ value: 291764969976, currency: "KRW", label: "매출액", consolidated: true, sources: ["dart"] });
    expect(await line("101160.KQ", "year", "2025-12", "total-debt")).toMatchObject({ value: 20705000000 + 11250000000 });
    expect(await line("101160.KQ", "year", "2025-12", "capex")).toMatchObject({ value: 5830719078 });
    const dartRows = await db.select().from(fetches).where(eq(fetches.source, "dart"));
    expect(JSON.stringify(dartRows.map((r) => [r.request, r.payload]))).not.toContain("secret-dart-key");
  });

  it("a source that fails keeps what it said before; one that answers replaces it", async () => {
    await runDimension(db, financials, { trigger: "test", ctx: ctx() });
    yahooDown = true;
    const report = await runDimension(db, financials, { trigger: "test", ctx: ctx() });
    expect(report.sources.find((s) => s.source === "yahoo")?.status).toBe("failed");
    expect((await line("MNRO", "year", "2026-03", "revenue")).sources).toEqual(["sec", "yahoo"]);
    const silver = await db.select().from(financialLines).where(and(eq(financialLines.symbol, "MNRO"), eq(financialLines.line, "revenue"), eq(financialLines.periodEnd, "2026-03")));
    expect(Object.keys(silver[0].observations).sort()).toEqual(["sec", "yahoo"]);
  });
});

describe("financials sources", () => {
  it("parses printed figures: thousands separators, brackets for negatives", () => {
    expect(parsePrinted("808,417")).toBe(808417);
    expect(parsePrinted("(12,345)")).toBe(-12345);
    expect(parsePrinted("—")).toBeNull();
    expect(parsePrinted("0.15")).toBe(0.15);
  });

  it("keeps a PDF figure only when it is printed on the page it cites, scaled by the column unit", () => {
    const payload = {
      version: "pdf-extract@v1",
      document: { title: "Annual Report 2025", url: "https://x/ar.pdf", filedAt: "2025-12-18T00:00:00Z" },
      pages: [{ page: 126, text: "Five-Year Financial Summary 2025 2024 HK$'000 Revenue 981,334 983,215 Profit 81,258" }],
      model: "sonnet",
      extraction: {
        currency: "HKD",
        periods: [
          { periodEnd: "2025-09", lines: [{ line: "revenue", printed: "981,334", unit: "thousand", page: 126, label: "Revenue" }, { line: "net-income", printed: "99,999", unit: "thousand", page: 126, label: "Profit" }] },
          { periodEnd: "2024-09", lines: [{ line: "revenue", printed: "983,215", unit: "thousand", page: 126, label: "Revenue" }, { line: "not-a-line", printed: "981,334", unit: "thousand", page: 126, label: "x" }] },
        ],
        segments: [{ periodEnd: "2025-09", axis: "product", name: "Skincare", printed: "81,258", unit: "thousand", page: 126 }],
      },
    };
    const r = pdfExtract.extract(payload);
    expect(r.find((x) => x.line === "revenue" && x.periodEnd === "2025-09")).toMatchObject({ value: 981_334_000, currency: "HKD", citation: { page: 126, quote: "981,334" } });
    // 99,999 is not on page 126: dropped. An unknown line key: dropped.
    expect(r.find((x) => x.line === "net-income")).toBeUndefined();
    expect(r.map((x) => x.line).sort()).toEqual(["revenue", "revenue", "segment:product:Skincare"]);
  });

  it("picks the summary and statement pages, never the table of contents", () => {
    const pages = ["Contents Five-Year Financial Summary Consolidated Statement of Profit or Loss Consolidated Statement of Cash Flows", "Chairman", "Consolidated Statement of Profit or Loss and Other Comprehensive Income ...", "(continued)", "Five-Year Financial Summary ..."];
    expect(pickPages(pages).map((p) => p.page)).toEqual([3, 4, 5]);
  });

  it("finds due fiscal years: a January year end is read once its report is due", () => {
    expect(dueFiscalYearEnds(1, new Date("2026-11-05T00:00:00Z"), 3).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2025-01-31", "2024-01-31"]);
    expect(dueFiscalYearEnds(3, new Date("2026-05-01T00:00:00Z"), 1).map((d) => d.toISOString().slice(0, 10))).toEqual(["2025-03-31"]);
  });

  it("reads an EDINET report: 5-year summary, consolidated over separate, debt from loans or zero when none", async () => {
    const tsv = (rows: string[][]) => ["要素ID\t項目名\tコンテキストID\t相対年度\t連結・個別\t期間・時点\tユニットID\t単位\t値", ...rows.map((r) => r.map((c) => `"${c}"`).join("\t"))].join("\n");
    const csv = tsv([
      ["jpcrp_cor:NetSalesSummaryOfBusinessResults", "売上高", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "12572137000"],
      ["jpcrp_cor:NetSalesSummaryOfBusinessResults", "売上高", "Prior4YearDuration", "四期前", "連結", "期間", "JPY", "円", "11661641000"],
      ["jpcrp_cor:NetSalesSummaryOfBusinessResults", "売上高", "CurrentYearDuration_NonConsolidatedMember", "当期", "個別", "期間", "JPY", "円", "1"],
      ["jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults", "株式数", "CurrentYearInstant_NonConsolidatedMember", "当期末", "個別", "時点", "shares", "株", "9600000"],
      ["jppfs_cor:OperatingIncome", "営業利益", "CurrentYearDuration", "当期", "連結", "期間", "JPY", "円", "511959000"],
      ["jppfs_cor:Liabilities", "負債合計", "CurrentYearInstant", "当期末", "連結", "時点", "JPY", "円", "3800000000"],
      ["jppfs_cor:Liabilities", "負債合計", "Prior1YearInstant", "前期末", "連結", "時点", "JPY", "円", "5900000000"],
      ["jppfs_cor:ShortTermLoansPayable", "短期借入金", "Prior1YearInstant", "前期末", "連結", "時点", "JPY", "円", "100000000"],
      ["jppfs_cor:NetSales", "売上高", "CurrentYearDuration_SegmentMember", "当期", "連結", "期間", "JPY", "円", "5"],
    ]);
    const zip = storedZip("XBRL_TO_CSV/jpcrp030000-asr-001_E02477-000_2026-01-31_01_2026-04-22.csv", utf16(csv));
    expect((await unzip(zip)).size).toBe(1);
    const rows = await edinetRows(zip);
    expect(rows).toHaveLength(8); // the segment-member row is dropped
    const r = edinetFinancials.extract({ documents: [{ docID: "S100Y0E4", periodEnd: "2026-01-31", description: "有価証券報告書", rows }] });
    const at = (periodEnd: string, l: string) => r.find((x) => x.periodEnd === periodEnd && x.line === l);
    expect(at("2026-01", "revenue")).toMatchObject({ value: 12572137000, consolidated: true, currency: "JPY" });
    expect(at("2022-01", "revenue")).toMatchObject({ value: 11661641000 });
    expect(at("2026-01", "shares-issued")).toMatchObject({ value: 9600000, consolidated: false });
    expect(at("2026-01", "total-debt")).toMatchObject({ value: 0, label: "no loans payable or bonds on the balance sheet" });
    expect(at("2025-01", "total-debt")).toMatchObject({ value: 100000000 });
  });

  it("agrees within 0.5%, the most sources first, then the most trusted", () => {
    const o = (value: number) => ({ value, currency: "USD", label: "x", consolidated: null, bronzeId: "b" });
    expect(lineConsensus({ yahoo: o(100), sec: o(100.4), "pdf-extract": o(120) }, ["sec", "yahoo", "pdf-extract"])).toEqual({ lead: "sec", sources: ["sec", "yahoo"], alternatives: [{ source: "pdf-extract", value: 120 }] });
    expect(lineConsensus({ yahoo: o(100), dart: o(110) }, ["dart", "yahoo"]).lead).toBe("dart");
  });

  it("derives a 3-month Q4 from the fiscal year minus Q1 to Q3, never over a filed Q4", () => {
    const r = (periodType: "year" | "quarter", periodEnd: string, value: number, line = "operating-income") => ({ periodType, periodEnd, line, value, currency: "KRW", label: "영업이익", consolidated: true });
    const q4 = fourthQuarters([r("year", "2025-12", 58.54), r("quarter", "2025-03", 14.77), r("quarter", "2025-06", 8.39), r("quarter", "2025-09", 13.02), r("year", "2024-12", 70), r("quarter", "2024-09", 1)]);
    expect(q4).toHaveLength(1);
    expect(q4[0]).toMatchObject({ periodType: "quarter", periodEnd: "2025-12", label: "영업이익 (fiscal year minus Q1 to Q3)" });
    expect(q4[0].value).toBeCloseTo(22.36, 6);
  });

  it("never computes a market value across currencies", () => {
    const l = (periodType: "year" | "month", periodEnd: string, line: string, value: number, currency: string) => ({ periodType, periodEnd, line, value, currency, sources: ["x"] });
    const m = deriveMetrics("AT.L", [l("year", "2025-12", "revenue", 1e8, "GBP"), l("year", "2025-12", "shares-outstanding", 1e6, "GBP"), l("month", "2025-12", "share-price", 300, "USD")]);
    expect(m.find((x) => x.metric === "market-cap")).toBeUndefined();
    const p = deriveMetrics("AT.L", [l("year", "2025-12", "revenue", 1e8, "GBP"), l("year", "2025-12", "shares-outstanding", 1e6, "GBP"), l("month", "2025-12", "share-price", 300, "GBp")]);
    expect(p.find((x) => x.metric === "market-cap")?.value).toBe(3e6);
  });
});

function utf16(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(`﻿${s}`, "utf16le"));
}

/** A one-entry zip (deflated), the shape EDINET serves. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + n.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat([local, n, body, central, n, eocd]));
}
