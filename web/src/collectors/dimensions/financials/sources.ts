import { and, desc, eq, isNull } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, SEC_HEADERS, dartCorpCode, isMarket, isoDate, memo, tickerBase } from "../../markets";
import type { FetchOutcome, Source, SourceContext } from "../../types";
import { parseNumber } from "../company-profile/sources";
import { LINES, isLineKey, reading, segmentLine, type LineReading, type PeriodType } from "./lines";
import { unzip } from "./zip";

/** A financials source = how to fetch one ticker's statements + how to read canonical lines out of the raw answer. */
export type FinancialsSource = Source & {
  /** Who publishes the numbers, said on the Data page. */
  publisher: string;
  extract: (payload: unknown) => LineReading[];
};

/** Node-only modules, hidden from every bundler (a non-literal specifier): the console Worker lists dimensions. */
const nodeImport = (spec: string): Promise<unknown> => import(/* webpackIgnore: true */ spec);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const month = (d: string) => d.slice(0, 7);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const YEARS = 5;

/** "2026-01" minus n years. */
const minusYears = (ym: string, n: number) => `${Number(ym.slice(0, 4)) - n}${ym.slice(4)}`;

// ---------- Yahoo fundamentals-timeseries: income, balance sheet, cash flow, every market (~4 years + 5 quarters) ----------

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };

/** Yahoo type -> canonical line. */
export const YAHOO_TYPES: Record<string, string> = {
  TotalRevenue: "revenue",
  CostOfRevenue: "cost-of-revenue",
  GrossProfit: "gross-profit",
  SellingGeneralAndAdministration: "sga",
  ResearchAndDevelopment: "rnd",
  OperatingIncome: "operating-income",
  ReconciledDepreciation: "depreciation-amortization",
  EBITDA: "ebitda-reported",
  InterestExpense: "interest-expense",
  PretaxIncome: "pretax-income",
  TaxProvision: "income-tax",
  NetIncome: "net-income",
  BasicEPS: "eps-basic",
  DilutedEPS: "eps-diluted",
  DilutedAverageShares: "shares-diluted-avg",
  CashAndCashEquivalents: "cash",
  OtherShortTermInvestments: "short-term-investments",
  AccountsReceivable: "receivables",
  Inventory: "inventory",
  CurrentAssets: "current-assets",
  NetPPE: "ppe",
  Goodwill: "goodwill",
  TotalAssets: "total-assets",
  CurrentLiabilities: "current-liabilities",
  CurrentDebt: "short-term-debt",
  LongTermDebt: "long-term-debt",
  TotalDebt: "total-debt",
  TotalLiabilitiesNetMinorityInterest: "total-liabilities",
  StockholdersEquity: "equity",
  TotalEquityGrossMinorityInterest: "total-equity",
  // EV bridge lines. Yahoo's preferred stock is the carrying value (par for most US issuers: the SEC filing wins).
  PreferredStock: "preferred-stock",
  MinorityInterest: "minority-interest",
  // Two Yahoo names for equity-method holdings: the first one present per period wins.
  InvestmentsInOtherVenturesUnderEquityMethod: "equity-investments",
  InvestmentsinAssociatesatCost: "equity-investments",
  OrdinarySharesNumber: "shares-outstanding",
  ShareIssued: "shares-issued",
  OperatingCashFlow: "cfo",
  CapitalExpenditure: "capex",
  FreeCashFlow: "fcf-reported",
  InvestingCashFlow: "cfi",
  FinancingCashFlow: "cff",
  CashDividendsPaid: "dividends-paid",
  RepurchaseOfCapitalStock: "buybacks",
  StockBasedCompensation: "stock-compensation",
};

type TimeseriesRow = { asOfDate?: string; currencyCode?: string; reportedValue?: { raw?: number } } | null;

/** Yahoo answers 429 in bursts: space calls, retry twice. */
async function yahooGet(ctx: SourceContext, url: string, request: Record<string, unknown>): Promise<FetchOutcome> {
  if (!process.env.VITEST) await sleep(400);
  let out = await getJson(ctx, url, request, { headers: YAHOO_HEADERS });
  for (const pause of process.env.VITEST ? [] : [5_000, 20_000]) {
    if (out.httpStatus !== 429) break;
    await sleep(pause);
    out = await getJson(ctx, url, { ...request, retried: true }, { headers: YAHOO_HEADERS });
  }
  return out;
}

export const yahoo: FinancialsSource = {
  name: "yahoo",
  publisher: "Yahoo Finance (Morningstar data), every market: 4 fiscal years + 5 quarters",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const types = Object.keys(YAHOO_TYPES).flatMap((t) => [`annual${t}`, `quarterly${t}`]).join(",");
    const p1 = Math.floor(Date.UTC(new Date().getUTCFullYear() - YEARS - 1, 0, 1) / 1000);
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types}&period1=${p1}&period2=${Math.floor(Date.now() / 1000)}`;
    return yahooGet(ctx, url, { url });
  },
  extract(payload) {
    const results = (payload as { timeseries?: { result?: Record<string, unknown>[] } })?.timeseries?.result ?? [];
    const out: LineReading[] = [];
    for (const r of results) {
      const type = (r.meta as { type?: string[] })?.type?.[0];
      if (!type) continue;
      const periodType: PeriodType | null = type.startsWith("annual") ? "year" : type.startsWith("quarterly") ? "quarter" : null;
      const base = type.replace(/^(annual|quarterly)/, "");
      const line = YAHOO_TYPES[base];
      if (!periodType || !line) continue;
      for (const row of (r[type] as TimeseriesRow[] | undefined) ?? []) {
        const value = num(row?.reportedValue?.raw);
        if (!row?.asOfDate || value === null) continue;
        out.push(reading({ periodType, periodEnd: month(row.asOfDate), line, value, currency: row.currencyCode ?? null, label: base, consolidated: null }));
      }
    }
    // Several Yahoo types can map to one line: keep the earliest type in YAHOO_TYPES order per (period, line).
    const order = Object.keys(YAHOO_TYPES);
    const kept = new Map<string, LineReading>();
    for (const r of out) {
      const k = `${r.periodType}|${r.periodEnd}|${r.line}`;
      const prior = kept.get(k);
      if (!prior || order.indexOf(r.label) < order.indexOf(prior.label)) kept.set(k, r);
    }
    return [...kept.values()];
  },
};

// ---------- Yahoo chart: month-end closes for 5 years (EV at each fiscal period end) ----------

/** Quote currencies Yahoo gives in minor units (pence, cents). */
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

type YahooChart = { meta: { currency?: string; gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } };

export const yahooChart: FinancialsSource = {
  name: "yahoo-chart",
  publisher: "Yahoo Finance month-end closes, 5 years, every market",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${YEARS + 1}y&interval=1mo`;
    const out = await yahooGet(ctx, url, { url });
    if (!out.error && !(out.payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0]) return { ...out, error: "Yahoo returned no chart for this symbol" };
    return out;
  },
  extract(payload) {
    const r = (payload as { chart: { result: YahooChart[] } }).chart.result[0];
    const raw = r.meta.currency ?? null;
    const currency = raw && MINOR_UNITS[raw] ? MINOR_UNITS[raw] : raw;
    const scale = raw && MINOR_UNITS[raw] ? 0.01 : 1;
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const byMonth = new Map<string, number>();
    (r.timestamp ?? []).forEach((ts, i) => {
      const close = closes[i];
      if (close === null || close === undefined) return;
      // A monthly bar is stamped on its first trading day; its close is the month's last close.
      byMonth.set(month(isoDate(new Date((ts + (r.meta.gmtoffset ?? 0)) * 1000))), close * scale);
    });
    return [...byMonth].map(([periodEnd, value]) => ({ periodType: "month" as const, periodEnd, line: "share-price", value, currency, label: "Monthly close", consolidated: null }));
  },
};

// ---------- OpenDART fnlttSinglAcntAll: Korea, full statements as filed ----------

/** DART report codes: annual, Q1, half-year, Q3. Korean listings close their fiscal year in December. */
const DART_REPORTS = { "11011": "12", "11013": "03", "11012": "06", "11014": "09" } as const;
type DartReportCode = keyof typeof DART_REPORTS;
type DartRow = { sj_div: string; account_id: string; account_nm: string; thstrm_amount?: string; currency?: string };
type DartReport = { bsnsYear: number; reprtCode: DartReportCode; fsDiv: "CFS" | "OFS"; status: string; list: DartRow[] };

const DART_IDS: Record<string, string> = {
  "ifrs-full_Revenue": "revenue",
  "ifrs-full_CostOfSales": "cost-of-revenue",
  "ifrs-full_GrossProfit": "gross-profit",
  dart_TotalSellingGeneralAdministrativeExpenses: "sga",
  dart_OperatingIncomeLoss: "operating-income",
  "ifrs-full_ProfitLossBeforeTax": "pretax-income",
  "ifrs-full_IncomeTaxExpenseContinuingOperations": "income-tax",
  "ifrs-full_ProfitLossAttributableToOwnersOfParent": "net-income",
  "ifrs-full_BasicEarningsLossPerShare": "eps-basic",
  "ifrs-full_DilutedEarningsLossPerShare": "eps-diluted",
  "ifrs-full_CashAndCashEquivalents": "cash",
  "ifrs-full_Inventories": "inventory",
  "ifrs-full_CurrentAssets": "current-assets",
  "ifrs-full_PropertyPlantAndEquipment": "ppe",
  "ifrs-full_Goodwill": "goodwill",
  "ifrs-full_Assets": "total-assets",
  "ifrs-full_CurrentLiabilities": "current-liabilities",
  "ifrs-full_Liabilities": "total-liabilities",
  "ifrs-full_EquityAttributableToOwnersOfParent": "equity",
  "ifrs-full_Equity": "total-equity",
  "ifrs-full_NoncontrollingInterests": "minority-interest",
  "ifrs-full_InvestmentsAccountedForUsingEquityMethod": "equity-investments",
  "ifrs-full_CashFlowsFromUsedInOperatingActivities": "cfo",
  "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "capex",
  "ifrs-full_CashFlowsFromUsedInInvestingActivities": "cfi",
  "ifrs-full_CashFlowsFromUsedInFinancingActivities": "cff",
  "ifrs-full_DividendsPaidClassifiedAsFinancingActivities": "dividends-paid",
};
/** Borrowings and bonds on a Korean balance sheet (labels as filed; leases are not debt here). */
const DART_SHORT_DEBT = /^(단기차입금|유동성장기차입금|유동성사채|유동성장기부채)$/;
const DART_LONG_DEBT = /^(장기차입금|사채)$/;
const DART_BUYBACK = /^자기주식의\s?취득$/;
const DART_DA = /^(감가상각비|무형자산상각비|사용권자산상각비|감가상각비\s?및\s?무형자산상각비)$/;

export const dart: FinancialsSource = {
  name: "dart",
  publisher: "OpenDART (Korea FSS), statements as filed: 5 annual reports + the last 2 years of quarterly reports",
  requiredEnv: ["DART_API_KEY"],
  covers: (symbol) => isMarket("KR")(symbol) && dartCorpCode(symbol) !== null,
  async fetch(symbol, ctx) {
    const corpCode = dartCorpCode(symbol)!;
    const now = new Date();
    const y = now.getUTCFullYear();
    const wanted: [number, DartReportCode][] = [
      ...Array.from({ length: YEARS }, (_, i) => [y - 1 - i, "11011"] as [number, DartReportCode]),
      ...[y, y - 1].flatMap((yr) => (["11013", "11012", "11014"] as const).map((rc) => [yr, rc] as [number, DartReportCode])),
    ];
    const reports: DartReport[] = [];
    let lastStatus = 200;
    for (const [bsnsYear, reprtCode] of wanted) {
      for (const fsDiv of ["CFS", "OFS"] as const) {
        const q = `corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=${fsDiv}`;
        const res = await ctx.fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${q}&crtfc_key=${ctx.env.DART_API_KEY}`);
        lastStatus = res.status;
        if (!res.ok) return { request: { url: "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json", query: q }, httpStatus: res.status, payloadText: await res.text(), error: `DART HTTP ${res.status}` };
        const body = (await res.json()) as { status: string; message?: string; list?: DartRow[] };
        // 013 = no data: not filed yet (or no consolidated statements: try the separate ones).
        if (body.status === "013") continue;
        if (body.status !== "000") return { request: { query: q }, httpStatus: res.status, payload: body, error: `DART status ${body.status}: ${body.message ?? ""}` };
        const list = (body.list ?? []).map((r) => ({ sj_div: r.sj_div, account_id: r.account_id, account_nm: r.account_nm, thstrm_amount: r.thstrm_amount, currency: r.currency }));
        reports.push({ bsnsYear, reprtCode, fsDiv, status: body.status, list });
        break;
      }
    }
    return {
      request: { url: "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json", corpCode, reports: wanted.map(([yr, rc]) => `${yr}/${rc}`), kept: "statement rows, current period amounts" },
      httpStatus: lastStatus,
      payload: { corpCode, reports },
      ...(reports.length === 0 ? { error: "DART has no statements for this company" } : {}),
    };
  },
  extract(payload) {
    const out: LineReading[] = [];
    for (const rep of (payload as { reports: DartReport[] }).reports) {
      const periodType: PeriodType = rep.reprtCode === "11011" ? "year" : "quarter";
      const periodEnd = `${rep.bsnsYear}-${DART_REPORTS[rep.reprtCode]}`;
      const consolidated = rep.fsDiv === "CFS";
      const seen = new Set<string>();
      const sums = { short: 0, long: 0, da: 0, buybacks: 0, shortN: 0, longN: 0, daN: 0, buyN: 0 };
      let currency: string | null = null;
      let hasBalance = false;
      for (const row of rep.list) {
        const isFlowCf = row.sj_div === "CF";
        // Quarterly cash flow statements are year-to-date: only annual cash flows are read.
        if (isFlowCf && periodType === "quarter") continue;
        const value = parseNumber(row.thstrm_amount);
        if (value === null) continue;
        currency = row.currency ?? currency;
        const name = row.account_nm.trim();
        if (row.sj_div === "BS") {
          hasBalance = true;
          if (DART_SHORT_DEBT.test(name)) { sums.short += value; sums.shortN++; }
          else if (DART_LONG_DEBT.test(name)) { sums.long += value; sums.longN++; }
        }
        if (isFlowCf && DART_DA.test(name)) { sums.da += value; sums.daN++; }
        if (isFlowCf && DART_BUYBACK.test(name)) { sums.buybacks += value; sums.buyN++; }
        const line = DART_IDS[row.account_id];
        if (!line || seen.has(line)) continue;
        seen.add(line);
        out.push(reading({ periodType, periodEnd, line, value, currency: row.currency ?? null, label: name, consolidated }));
      }
      // Net income: the attributable line when filed, else the group's net income (no minorities).
      if (!seen.has("net-income")) {
        const total = rep.list.find((r) => r.account_id === "ifrs-full_ProfitLoss" && r.sj_div !== "CF");
        const v = parseNumber(total?.thstrm_amount);
        if (v !== null) out.push({ periodType, periodEnd, line: "net-income", value: v, currency, label: total!.account_nm.trim(), consolidated });
      }
      const add = (line: string, value: number, label: string) => out.push(reading({ periodType, periodEnd, line, value, currency, label, consolidated }));
      if (sums.shortN) add("short-term-debt", sums.short, "sum of 단기차입금, 유동성장기차입금, 유동성사채");
      if (sums.longN) add("long-term-debt", sums.long, "sum of 장기차입금, 사채");
      if (hasBalance) add("total-debt", sums.short + sums.long, sums.shortN + sums.longN ? "sum of borrowings and bonds" : "no borrowings or bonds on the balance sheet");
      if (sums.daN) add("depreciation-amortization", sums.da, "감가상각비 + 무형자산상각비 (cash flow adjustments)");
      if (sums.buyN) add("buybacks", sums.buybacks, "자기주식의 취득");
    }
    return [...out, ...fourthQuarters(out)];
  },
};

/** Income lines whose Q4 is the fiscal year minus Q1..Q3 (a cumulative figure); per-share lines are not additive. */
const ADDITIVE = new Set(["revenue", "cost-of-revenue", "gross-profit", "sga", "operating-income", "pretax-income", "income-tax", "net-income"]);

/**
 * DART files no Q4 report: its 3-month Q4 = the annual figure minus the three filed quarters, all from the same source
 * and basis (Yahoo's own Q4 uses another operating income definition: Worldex Q4 2025 KRW 35.7B vs 22.4B filed).
 */
export function fourthQuarters(readings: LineReading[]): LineReading[] {
  const at = new Map(readings.map((r) => [`${r.periodType}|${r.periodEnd}|${r.line}`, r]));
  const out: LineReading[] = [];
  for (const fy of readings) {
    if (fy.periodType !== "year" || !ADDITIVE.has(fy.line)) continue;
    const y = Number(fy.periodEnd.slice(0, 4));
    const m = Number(fy.periodEnd.slice(5, 7));
    const ends = [9, 6, 3].map((back) => {
      const d = new Date(Date.UTC(y, m - 1 - back, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    const qs = ends.map((e) => at.get(`quarter|${e}|${fy.line}`));
    if (qs.some((q) => !q) || at.has(`quarter|${fy.periodEnd}|${fy.line}`)) continue;
    out.push({ ...fy, periodType: "quarter", value: fy.value - qs.reduce((s, q) => s + q!.value, 0), label: `${fy.label} (fiscal year minus Q1 to Q3)` });
  }
  return out;
}

// ---------- SEC companyfacts (XBRL): US, every 10-K / 10-Q ----------

/** Canonical line -> us-gaap tags, in order of preference. */
const SEC_TAGS: Record<string, string[]> = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  "cost-of-revenue": ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  "gross-profit": ["GrossProfit"],
  sga: ["SellingGeneralAndAdministrativeExpense"],
  rnd: ["ResearchAndDevelopmentExpense"],
  "operating-income": ["OperatingIncomeLoss"],
  "depreciation-amortization": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"],
  "interest-expense": ["InterestExpense", "InterestExpenseNonoperating"],
  "pretax-income": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  "income-tax": ["IncomeTaxExpenseBenefit"],
  "net-income": ["NetIncomeLoss"],
  "eps-basic": ["EarningsPerShareBasic"],
  "eps-diluted": ["EarningsPerShareDiluted"],
  "shares-diluted-avg": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  receivables: ["AccountsReceivableNetCurrent"],
  inventory: ["InventoryNet"],
  "current-assets": ["AssetsCurrent"],
  ppe: ["PropertyPlantAndEquipmentNet"],
  goodwill: ["Goodwill"],
  "total-assets": ["Assets"],
  "current-liabilities": ["LiabilitiesCurrent"],
  "short-term-debt": ["DebtCurrent", "LongTermDebtCurrent"],
  "long-term-debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
  "short-borrowings": ["ShortTermBorrowings"],
  "short-term-investments": ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  // Redeemable preferred shown outside equity (mezzanine) at its carrying value; the filing's liquidation value wins.
  "preferred-stock": ["TemporaryEquityCarryingAmountAttributableToParent"],
  "minority-interest": ["MinorityInterest"],
  "equity-investments": ["EquityMethodInvestments"],
  "total-liabilities": ["Liabilities"],
  equity: ["StockholdersEquity"],
  "total-equity": ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  "shares-outstanding": ["CommonStockSharesOutstanding"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  cfi: ["NetCashProvidedByUsedInInvestingActivities"],
  cff: ["NetCashProvidedByUsedInFinancingActivities"],
  "dividends-paid": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  "stock-compensation": ["ShareBasedCompensation"],
};
const SEC_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F", "10-KT"]);
type SecFact = { start?: string; end: string; val: number; fp?: string; form?: string; filed?: string; accn?: string };
type SecConcept = { label?: string; units: Record<string, SecFact[]> };

/** The SEC's 10-digit CIK of a US ticker, from its ticker map (one fetch per run). */
async function secCik(ctx: SourceContext, symbol: string): Promise<string | null> {
  const ciks = await memo(ctx, "sec-ciks", async () => {
    const res = await ctx.fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
    if (!res.ok) throw new Error(`SEC ticker map: HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
    return new Map(Object.values(raw).map((v) => [v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0")]));
  });
  return ciks.get(symbol.toUpperCase().replace(".", "-")) ?? null;
}

export const secCompanyFacts: FinancialsSource = {
  name: "sec",
  publisher: "SEC EDGAR XBRL company facts: every 10-K and 10-Q as filed",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const cik = await secCik(ctx, symbol);
    if (!cik) return { request: { symbol }, httpStatus: null, error: "Not an SEC filer (ticker absent from SEC's company_tickers.json)" };
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const out = await getJson(ctx, url, { url, cik, kept: `mapped us-gaap concepts, periods ending in the last ${YEARS + 1} years` }, { headers: SEC_HEADERS });
    if (out.error) return out;
    const p = out.payload as { cik: number; entityName: string; facts?: { "us-gaap"?: Record<string, SecConcept> } };
    const since = `${new Date().getUTCFullYear() - YEARS - 1}-01-01`;
    const wanted = new Set(Object.values(SEC_TAGS).flat());
    const kept: Record<string, SecConcept> = {};
    for (const [tag, c] of Object.entries(p.facts?.["us-gaap"] ?? {})) {
      if (!wanted.has(tag)) continue;
      kept[tag] = {
        label: c.label,
        units: Object.fromEntries(Object.entries(c.units).map(([u, list]) => [u, list.filter((f) => f.end >= since && SEC_FORMS.has(f.form ?? "")).map(({ start, end, val, fp, form, filed, accn }) => ({ start, end, val, fp, form, filed, accn }))])),
      };
    }
    return { ...out, payload: { cik: p.cik, entityName: p.entityName, facts: { "us-gaap": kept } } };
  },
  extract(payload) {
    const concepts = (payload as { facts: { "us-gaap": Record<string, SecConcept> } }).facts["us-gaap"];
    // (line, periodType, end) -> chosen value: the first tag in preference order, latest filing among duplicates.
    const chosen = new Map<string, { line: string; periodType: PeriodType; periodEnd: string; value: number; label: string; currency: string | null; rank: number; filed: string }>();
    for (const [line, tags] of Object.entries(SEC_TAGS)) {
      tags.forEach((tag, rank) => {
        const c = concepts[tag];
        if (!c) return;
        for (const [unit, list] of Object.entries(c.units)) {
          const currency = unit.startsWith("USD") ? "USD" : null;
          for (const f of list) {
            let periodType: PeriodType;
            if (f.start) {
              const days = (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000;
              if (days >= 350 && days <= 380) periodType = "year";
              else if (days >= 84 && days <= 98) periodType = "quarter";
              else continue;
            } else periodType = f.fp === "FY" ? "year" : "quarter";
            const key = `${line}|${periodType}|${month(f.end)}`;
            const prior = chosen.get(key);
            const filed = f.filed ?? "";
            if (prior && (prior.rank < rank || (prior.rank === rank && prior.filed >= filed))) continue;
            chosen.set(key, { line, periodType, periodEnd: month(f.end), value: f.val, label: tag, currency, rank, filed });
          }
        }
      });
    }
    const out: LineReading[] = [];
    const debt = new Map<string, { short: number; long: number; parts: string[]; periodType: PeriodType; periodEnd: string }>();
    for (const c of chosen.values()) {
      if (c.line === "short-borrowings" || c.line === "short-term-debt" || c.line === "long-term-debt") {
        const k = `${c.periodType}|${c.periodEnd}`;
        const d = debt.get(k) ?? { short: 0, long: 0, parts: [], periodType: c.periodType, periodEnd: c.periodEnd };
        if (c.line === "long-term-debt") d.long += c.value;
        else d.short += c.value;
        d.parts.push(c.label);
        debt.set(k, d);
        if (c.line === "short-borrowings") continue;
      }
      out.push(reading({ periodType: c.periodType, periodEnd: c.periodEnd, line: c.line, value: c.value, currency: c.currency, label: c.label, consolidated: true }));
    }
    for (const d of debt.values()) out.push({ periodType: d.periodType, periodEnd: d.periodEnd, line: "total-debt", value: d.short + d.long, currency: "USD", label: `sum of ${d.parts.join(", ")}`, consolidated: true });
    return out;
  },
};

// ---------- SEC filings (inline XBRL): preferred stock at its liquidation value, per series ----------

/**
 * Company facts drop every fact tagged by share class, and most issuers carry preferred stock at par (CareCloud:
 * $1 thousand for 984,530 Series A shares with a $25 liquidation preference). The bridge needs what a holder is owed:
 * shares outstanding per series x liquidation preference per share, read from the filings themselves.
 */
const SEC_FILING_FACTS = new Set([
  "us-gaap:PreferredStockSharesOutstanding",
  "us-gaap:PreferredStockSharesIssued",
  "us-gaap:PreferredStockLiquidationPreference",
  "us-gaap:PreferredStockLiquidationPreferenceValue",
]);
const SEC_ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F", "10-KT"]);
/** A tagged fact: its date (instant), the members of its context (share class...), its value in full units. */
export type SecFilingFact = { name: string; date: string; members: string[]; value: number };
export type SecFilingDoc = { accession: string; form: string; reportDate: string; url: string; facts: SecFilingFact[] };

/** Reads the preferred-stock facts out of one inline XBRL document. */
export function inlineXbrlFacts(html: string): SecFilingFact[] {
  const contexts = new Map<string, { date: string; members: string[] }>();
  for (const m of html.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const date = m[2].match(/<(?:xbrli:)?instant>\s*([\d-]+)\s*</)?.[1] ?? m[2].match(/<(?:xbrli:)?endDate>\s*([\d-]+)\s*</)?.[1];
    if (!date) continue;
    const members = [...m[2].matchAll(/<xbrldi:explicitMember\b[^>]*>\s*([^<\s]+)\s*</g)].map((x) => x[1]);
    contexts.set(m[1], { date, members });
  }
  const out: SecFilingFact[] = [];
  // Facts nest (an "issued" fact wrapping the "outstanding" one): each opening tag reads the text up to the next close.
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>/g)) {
    const end = html.indexOf("</ix:nonFraction>", m.index + m[0].length);
    if (end < 0) continue;
    const attr = (k: string) => m[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
    const name = attr("name");
    if (!name || !SEC_FILING_FACTS.has(name)) continue;
    const ctx = contexts.get(attr("contextRef") ?? "");
    if (!ctx) continue;
    const text = html.slice(m.index + m[0].length, end).replace(/<[^>]+>/g, "").trim();
    const zero = /zerodash|fixed-zero/.test(attr("format") ?? "") || /^[-–—]$/.test(text);
    const raw = zero ? 0 : parseNumber(text.replace(/[()]/g, ""));
    if (raw === null) continue;
    const value = raw * 10 ** Number(attr("scale") ?? 0) * (attr("sign") === "-" ? -1 : 1);
    out.push({ name: name.replace(/^us-gaap:/, ""), date: ctx.date, members: ctx.members, value });
  }
  return out;
}

/** "us-gaap:SeriesAPreferredStockMember" -> "Series A preferred"; no class -> "preferred". */
const seriesName = (member: string) => `${member.replace(/^.*:/, "").replace(/PreferredStockMember$|Member$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim()} preferred`.trim();

/**
 * Preferred stock per balance sheet date = sum over series of shares outstanding x liquidation preference per share
 * (the aggregate liquidation value when the filing tags it). A series without a known preference leaves the date out:
 * the carrying value from company facts or Yahoo stands then. Pure.
 */
export function preferredFromFilings(docs: SecFilingDoc[]): LineReading[] {
  // Oldest filing first: a later filing's figure for the same date (a restatement) overwrites an earlier one.
  const facts = [...docs].sort((a, b) => a.reportDate.localeCompare(b.reportDate)).flatMap((d) => d.facts);
  const fyeMonth = docs.filter((d) => SEC_ANNUAL_FORMS.has(d.form)).map((d) => d.reportDate.slice(5, 7))[0] ?? null;
  // One class member per fact (a breakdown by holder or a scenario is another axis: skipped).
  const series = (f: SecFilingFact) => (f.members.length === 0 ? "" : f.members.length === 1 ? f.members[0] : null);
  const prefPerShare = (s: string, date: string): number | null => {
    // Per-share terms tagged on that class (a dated amendment or scenario member beside it is fine).
    const tagged = facts.filter((f) => f.name === "PreferredStockLiquidationPreference" && f.value > 0 && (s === "" ? f.members.length === 0 : f.members.includes(s)));
    const pool = tagged.length ? tagged : facts.filter((f) => f.name === "PreferredStockLiquidationPreference" && f.value > 0 && f.members.length === 0);
    if (!pool.length) return null;
    const before = pool.filter((f) => f.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
    return (before ?? [...pool].sort((a, b) => a.date.localeCompare(b.date))[0]).value;
  };
  const dates = [...new Set(facts.filter((f) => f.name.startsWith("PreferredStockShares") || f.name === "PreferredStockLiquidationPreferenceValue").map((f) => f.date))].sort();
  const out: LineReading[] = [];
  for (const date of dates) {
    const periodEnd = month(date);
    const periodType: PeriodType = fyeMonth && periodEnd.slice(5, 7) === fyeMonth ? "year" : "quarter";
    const aggregate = facts.find((f) => f.name === "PreferredStockLiquidationPreferenceValue" && f.date === date && f.members.length === 0);
    if (aggregate) {
      out.push({ periodType, periodEnd, line: "preferred-stock", value: aggregate.value, currency: "USD", label: "aggregate liquidation preference", consolidated: true });
      continue;
    }
    // Shares per series at that date: outstanding when tagged, else issued.
    const shares = new Map<string, number>();
    for (const name of ["PreferredStockSharesIssued", "PreferredStockSharesOutstanding"]) {
      for (const f of facts.filter((x) => x.name === name && x.date === date)) {
        const s = series(f);
        if (s !== null) shares.set(s, f.value);
      }
    }
    // A total without series beside per-series rows double counts: keep the series.
    if (shares.size > 1) shares.delete("");
    if (shares.size === 0) continue;
    const parts: string[] = [];
    let value = 0;
    let complete = true;
    for (const [s, n] of [...shares].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n === 0) {
        parts.push(`${seriesName(s)}: none outstanding`);
        continue;
      }
      const pref = prefPerShare(s, date);
      if (pref === null) {
        complete = false;
        break;
      }
      value += n * pref;
      parts.push(`${n.toLocaleString("en-US")} ${seriesName(s)} shares x $${pref.toFixed(2)} liquidation preference`);
    }
    if (!complete) continue;
    out.push({ periodType, periodEnd, line: "preferred-stock", value, currency: "USD", label: parts.join("; "), consolidated: true });
  }
  return out;
}

/** The filings read: every 10-K / 10-Q / 20-F of the last YEARS + 1 years, so each balance sheet date has its own. */
const SEC_FILING_MAX = 28;

export const secFilings: FinancialsSource = {
  name: "sec-filings",
  publisher: "SEC EDGAR 10-K and 10-Q filings (inline XBRL), 5 years: preferred stock per series at its liquidation value",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const cik = await secCik(ctx, symbol);
    if (!cik) return { request: { symbol }, httpStatus: null, error: "Not an SEC filer (ticker absent from SEC's company_tickers.json)" };
    const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const sub = await getJson(ctx, subUrl, { url: subUrl }, { headers: SEC_HEADERS });
    if (sub.error) return sub;
    const r = (sub.payload as { filings: { recent: { form: string[]; reportDate: string[]; accessionNumber: string[]; primaryDocument: string[] } } }).filings.recent;
    const all = r.form.map((form, i) => ({ form, reportDate: r.reportDate[i], accession: r.accessionNumber[i], doc: r.primaryDocument[i] })).filter((f) => f.reportDate && /\.htm$/.test(f.doc));
    const since = `${new Date().getUTCFullYear() - YEARS - 1}-01-01`;
    const wanted = all.filter((f) => (SEC_ANNUAL_FORMS.has(f.form) || f.form === "10-Q") && f.reportDate >= since).slice(0, SEC_FILING_MAX);
    // A filing never changes once filed: reuse what the last successful run read.
    const previous = ctx.db
      ? ((await ctx.db.select({ payload: fetches.payload }).from(fetches).where(and(eq(fetches.dimension, "financials"), eq(fetches.source, "sec-filings"), eq(fetches.subject, symbol), isNull(fetches.error))).orderBy(desc(fetches.fetchedAt)).limit(1))[0]?.payload as { documents?: SecFilingDoc[] } | undefined)
      : undefined;
    const documents: SecFilingDoc[] = [];
    for (const f of wanted) {
      const known = previous?.documents?.find((d) => d.accession === f.accession);
      if (known) {
        documents.push(known);
        continue;
      }
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g, "")}/${f.doc}`;
      const res = await ctx.fetch(url, { headers: SEC_HEADERS });
      if (!res.ok) return { request: { url }, httpStatus: res.status, payloadText: (await res.text()).slice(0, 500), error: `SEC filing ${f.accession}: HTTP ${res.status}` };
      documents.push({ accession: f.accession, form: f.form, reportDate: f.reportDate, url, facts: inlineXbrlFacts(await res.text()) });
    }
    return {
      request: { url: subUrl, cik, filings: wanted.map((f) => `${f.form} ${f.reportDate}`), kept: "preferred stock facts (shares per series, liquidation preference)" },
      httpStatus: 200,
      payload: { cik, documents },
      ...(documents.length === 0 ? { error: "no 10-K, 20-F or 10-Q filed as HTML" } : {}),
    };
  },
  extract(payload) {
    return preferredFromFilings((payload as { documents: SecFilingDoc[] }).documents);
  },
};

// ---------- EDINET (Japan FSA): annual securities reports (有価証券報告書), 5-year summary + full statements ----------

type EdinetRow = { element: string; context: string; unit: string; value: string };
type EdinetDoc = { docID: string; periodEnd: string; description: string; rows: EdinetRow[]; rowsVersion?: number };

/** 5-year summary (経営指標等) elements -> canonical line. */
const EDINET_SUMMARY: Record<string, string> = {
  NetSalesSummaryOfBusinessResults: "revenue",
  RevenueIFRSSummaryOfBusinessResults: "revenue",
  NetSalesIFRSSummaryOfBusinessResults: "revenue",
  OperatingRevenue1SummaryOfBusinessResults: "revenue",
  OrdinaryIncomeLossSummaryOfBusinessResults: "ordinary-income",
  OperatingProfitLossIFRSSummaryOfBusinessResults: "operating-income",
  ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults: "net-income",
  ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults: "net-income",
  NetIncomeLossSummaryOfBusinessResults: "net-income",
  NetAssetsSummaryOfBusinessResults: "total-equity",
  TotalAssetsSummaryOfBusinessResults: "total-assets",
  TotalAssetsIFRSSummaryOfBusinessResults: "total-assets",
  BasicEarningsLossPerShareSummaryOfBusinessResults: "eps-basic",
  DilutedEarningsPerShareSummaryOfBusinessResults: "eps-diluted",
  NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults: "cfo",
  NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults: "cfi",
  NetCashProvidedByUsedInFinancingActivitiesSummaryOfBusinessResults: "cff",
  CashAndCashEquivalentsSummaryOfBusinessResults: "cash",
  CashAndCashEquivalentsIFRSSummaryOfBusinessResults: "cash",
  TotalNumberOfIssuedSharesSummaryOfBusinessResults: "shares-issued",
};
/** Full statement (jppfs_cor, Japan GAAP) elements -> canonical line, current and prior year. */
const EDINET_STATEMENTS: Record<string, string> = {
  NetSales: "revenue",
  CostOfSales: "cost-of-revenue",
  GrossProfit: "gross-profit",
  SellingGeneralAndAdministrativeExpenses: "sga",
  OperatingIncome: "operating-income",
  IncomeBeforeIncomeTaxes: "pretax-income",
  IncomeTaxes: "income-tax",
  DepreciationAndAmortizationOpeCF: "depreciation-amortization",
  PurchaseOfPropertyPlantAndEquipmentInvCF: "capex",
  CashDividendsPaidFinCF: "dividends-paid",
  PurchaseOfTreasuryStockFinCF: "buybacks",
  CurrentAssets: "current-assets",
  PropertyPlantAndEquipment: "ppe",
  Assets: "total-assets",
  CurrentLiabilities: "current-liabilities",
  Liabilities: "total-liabilities",
  Inventories: "inventory",
  NonControllingInterests: "minority-interest",
  ShortTermInvestmentSecurities: "short-term-investments",
};
/** Bump when the kept rows change (new mapped elements): a stored report read with fewer rows is downloaded again. */
const EDINET_ROWS_VERSION = 2;
const EDINET_SHORT_DEBT = new Set(["ShortTermLoansPayable", "CurrentPortionOfLongTermLoansPayable", "CurrentPortionOfBonds", "CommercialPapersLiabilities"]);
const EDINET_LONG_DEBT = new Set(["LongTermLoansPayable", "BondsPayable", "ConvertibleBondTypeBondsWithSubscriptionRights"]);
const EDINET_CONTEXT = /^(Current|Prior(\d))Year(Duration|Instant)(_NonConsolidatedMember)?$/;

/** Fiscal year end month of a Japanese listing, from its TDnet earnings releases ("2026年１月期 決算短信"). */
async function japanFiscalYearEnd(ctx: SourceContext, symbol: string): Promise<number | null> {
  if (!ctx.db) return null;
  const rows = await ctx.db.select({ title: gold.filings.title }).from(gold.filings).where(and(eq(gold.filings.symbol, symbol), eq(gold.filings.registry, "tdnet")));
  for (const { title } of rows) {
    const m = title.normalize("NFKC").match(/(\d{4})年\s*(\d{1,2})月期/);
    if (m && /決算短信/.test(title)) return Number(m[2]);
  }
  return null;
}

/** Latest fiscal year ends whose annual report is due (3 months after the year end): newest first. */
export function dueFiscalYearEnds(fyeMonth: number, today: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let y = today.getUTCFullYear(); out.length < count && y > today.getUTCFullYear() - 10; y--) {
    const end = new Date(Date.UTC(y, fyeMonth, 0));
    if (end.getTime() + 100 * 86_400_000 <= today.getTime()) out.push(end);
  }
  return out;
}

/** The annual securities report of one fiscal year: scanned on EDINET's day lists 70 to 105 days after the year end. */
async function findAnnualReport(ctx: SourceContext, secCode: string, fyEnd: Date): Promise<Record<string, string> | null> {
  for (let d = 70; d <= 105; d++) {
    const date = isoDate(new Date(fyEnd.getTime() + d * 86_400_000));
    const day = await memo(ctx, `edinet:${date}`, async () => {
      const res = await ctx.fetch(`https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2&Subscription-Key=${ctx.env.EDINET_API_KEY}`);
      if (!res.ok) throw new Error(`EDINET ${date}: HTTP ${res.status}`);
      const body = (await res.json()) as { results?: Record<string, string>[]; metadata?: { message?: string } };
      if (!body.results) throw new Error(`EDINET ${date}: ${body.metadata?.message ?? "no results"}`);
      return body.results;
    });
    const doc = day.find((x) => x.secCode === secCode && x.docTypeCode === "120" && x.withdrawalStatus === "0" && x.csvFlag === "1" && x.periodEnd === isoDate(fyEnd));
    if (doc) return doc;
  }
  return null;
}

/** Reads the XBRL-to-CSV zip of one report (UTF-16 TSV): keeps the summary and statement rows we map. */
export async function edinetRows(zip: Uint8Array): Promise<EdinetRow[]> {
  const files = await unzip(zip);
  const main = [...files].find(([name]) => /jpcrp\d+-asr/.test(name));
  if (!main) throw new Error("EDINET zip holds no annual report CSV");
  const text = new TextDecoder("utf-16le").decode(main[1]).replace(/^﻿/, "");
  const rows: EdinetRow[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const c = line.split("\t").map((x) => x.replace(/^"|"$/g, ""));
    if (c.length < 9) continue;
    const [prefix, element] = c[0].split(":");
    const wanted =
      (prefix === "jpcrp_cor" && element in EDINET_SUMMARY) ||
      (prefix === "jppfs_cor" && (element in EDINET_STATEMENTS || EDINET_SHORT_DEBT.has(element) || EDINET_LONG_DEBT.has(element)));
    if (wanted && EDINET_CONTEXT.test(c[2])) rows.push({ element: c[0], context: c[2], unit: c[7], value: c[8] });
  }
  return rows;
}

export const edinetFinancials: FinancialsSource = {
  name: "edinet",
  publisher: "EDINET (Japan FSA) annual securities reports: 5-year summary + statements, 3 reports",
  requiredEnv: ["EDINET_API_KEY"],
  covers: isMarket("JP"),
  async fetch(symbol, ctx) {
    const secCode = `${tickerBase(symbol)}0`;
    const fyeMonth = await japanFiscalYearEnd(ctx, symbol);
    if (!fyeMonth) return { request: { symbol }, httpStatus: null, error: "fiscal year end unknown: no TDnet earnings release (決算短信) collected yet" };
    // Reports 2 years apart: each holds the current and prior year statements, and a 5-year summary.
    const due = dueFiscalYearEnds(fyeMonth, new Date(), 5).filter((_, i) => i % 2 === 0);
    const previous = ctx.db
      ? ((await ctx.db.select({ payload: fetches.payload }).from(fetches).where(and(eq(fetches.dimension, "financials"), eq(fetches.source, "edinet"), eq(fetches.subject, symbol), isNull(fetches.error))).orderBy(desc(fetches.fetchedAt)).limit(1))[0]?.payload as { documents?: EdinetDoc[] } | undefined)
      : undefined;
    const documents: EdinetDoc[] = [];
    for (const fyEnd of due) {
      const periodEnd = isoDate(fyEnd);
      const known = previous?.documents?.find((d) => d.periodEnd === periodEnd && d.rowsVersion === EDINET_ROWS_VERSION);
      if (known) {
        documents.push(known);
        continue;
      }
      const doc = await findAnnualReport(ctx, secCode, fyEnd);
      if (!doc) continue;
      const res = await ctx.fetch(`https://api.edinet-fsa.go.jp/api/v2/documents/${doc.docID}?type=5&Subscription-Key=${ctx.env.EDINET_API_KEY}`);
      if (!res.ok) return { request: { docID: doc.docID }, httpStatus: res.status, payloadText: await res.text(), error: `EDINET document ${doc.docID}: HTTP ${res.status}` };
      documents.push({ docID: doc.docID, periodEnd, description: doc.docDescription, rows: await edinetRows(new Uint8Array(await res.arrayBuffer())), rowsVersion: EDINET_ROWS_VERSION });
    }
    return {
      request: { url: "https://api.edinet-fsa.go.jp/api/v2/documents", secCode, fiscalYearEnds: due.map(isoDate), kept: "summary and statement rows we map" },
      httpStatus: 200,
      payload: { secCode, documents },
      ...(documents.length === 0 ? { error: `no annual securities report found on EDINET for fiscal years ending ${due.map(isoDate).join(", ")}` } : {}),
    };
  },
  extract(payload) {
    const out: LineReading[] = [];
    for (const doc of (payload as { documents: EdinetDoc[] }).documents) {
      const fy = month(doc.periodEnd);
      // Consolidated first; a company without subsidiaries only files the separate (non-consolidated) figures.
      const consolidatedElements = new Set(doc.rows.filter((r) => !r.context.endsWith("_NonConsolidatedMember")).map((r) => r.element));
      const debt = new Map<string, { short: number; long: number; n: number; consolidated: boolean }>();
      const balanceSeen = new Map<string, boolean>();
      for (const r of doc.rows) {
        const m = r.context.match(EDINET_CONTEXT)!;
        const consolidated = !m[4];
        if (!consolidated && consolidatedElements.has(r.element)) continue;
        const value = parseNumber(r.value.replace(/△/g, "-"));
        if (value === null) continue;
        const yearsBack = m[1] === "Current" ? 0 : Number(m[2]);
        const periodEnd = minusYears(fy, yearsBack);
        const [prefix, element] = r.element.split(":");
        const currency = "JPY";
        if (prefix === "jppfs_cor" && (EDINET_SHORT_DEBT.has(element) || EDINET_LONG_DEBT.has(element))) {
          const d = debt.get(periodEnd) ?? { short: 0, long: 0, n: 0, consolidated };
          if (EDINET_SHORT_DEBT.has(element)) d.short += value;
          else d.long += value;
          d.n++;
          debt.set(periodEnd, d);
          continue;
        }
        const line = prefix === "jpcrp_cor" ? EDINET_SUMMARY[element] : EDINET_STATEMENTS[element];
        if (!line) continue;
        if (prefix === "jppfs_cor" && element === "Liabilities" && m[3] === "Instant") balanceSeen.set(periodEnd, consolidated);
        out.push(reading({ periodType: "year", periodEnd, line, value, currency, label: element, consolidated }));
      }
      for (const [periodEnd, consolidated] of balanceSeen) {
        const d = debt.get(periodEnd);
        const label = d ? "sum of loans payable and bonds" : "no loans payable or bonds on the balance sheet";
        if (d?.short) out.push({ periodType: "year", periodEnd, line: "short-term-debt", value: d.short, currency: "JPY", label: "short-term loans + current portion", consolidated });
        if (d?.long) out.push({ periodType: "year", periodEnd, line: "long-term-debt", value: d.long, currency: "JPY", label: "long-term loans + bonds", consolidated });
        out.push({ periodType: "year", periodEnd, line: "total-debt", value: d ? d.short + d.long : 0, currency: "JPY", label, consolidated });
      }
    }
    // The newest report wins for a year two reports both carry (restatements).
    const latest = new Map<string, LineReading>();
    for (const r of out) latest.set(`${r.periodType}|${r.periodEnd}|${r.line}`, latest.get(`${r.periodType}|${r.periodEnd}|${r.line}`) ?? r);
    return [...latest.values()];
  },
};

// ---------- Annual report PDF, read by Claude: markets without a free structured source (Hong Kong) ----------

export const PDF_EXTRACT_VERSION = "pdf-extract@v1";
type PdfPage = { page: number; text: string };
type PdfExtraction = {
  currency?: string;
  periods?: { periodEnd: string; lines: { line: string; printed: string; unit: string; page: number; label: string }[] }[];
  segments?: { periodEnd: string; axis: string; name: string; printed: string; unit: string; page: number }[];
};
type PdfPayload = { version: string; document: { title: string; url: string; filedAt: string }; pages: PdfPage[]; extraction: PdfExtraction; model: string };

/** Pages worth reading: the 5-year summary, the primary statements, the segment note. */
const PAGE_PATTERNS = [
  /five[- ]year (financial )?summary|financial summary/i,
  /consolidated statement of (profit or loss|comprehensive income|income)/i,
  /consolidated statement of financial position|consolidated balance sheet/i,
  /consolidated statement of cash flows/i,
  /segment information/i,
];
const MAX_PAGES = 12;
const MAX_PAGE_CHARS = 7000;

/** The PDF's pages that hold the figures (a statement page and the page after it). */
export function pickPages(pages: string[]): PdfPage[] {
  // A table of contents names every statement: never a figure page.
  const isContents = (t: string) => PAGE_PATTERNS.filter((re) => re.test(t)).length >= 3;
  const picked: number[] = [];
  for (const re of PAGE_PATTERNS) {
    const hits = pages.map((t, i) => (!isContents(t) && re.test(t.slice(0, 400)) ? i : -1)).filter((i) => i >= 0);
    for (const i of hits.slice(0, 2)) for (const j of /summary/i.test(re.source) ? [i] : [i, i + 1]) if (j < pages.length && !picked.includes(j)) picked.push(j);
  }
  // Pattern order = priority (the 5-year summary first), capped, then read in page order.
  return picked.slice(0, MAX_PAGES).sort((a, b) => a - b).map((i) => ({ page: i + 1, text: pages[i].slice(0, MAX_PAGE_CHARS) }));
}

const PDF_SYSTEM = [
  "You read pages of a listed company's annual report and copy its published financial figures. You never compute, estimate or round.",
  "Answer with JSON only, no prose, no code fence.",
].join(" ");

const pdfPrompt = (title: string, pages: PdfPage[]) =>
  [
    `Document: ${title}. Each page below starts with its PDF page number.`,
    "Copy every figure you find for these canonical lines, for every fiscal year shown (the five-year summary gives five):",
    Object.entries(LINES)
      .filter(([, v]) => v.statement !== "market")
      .map(([k, v]) => `${k} (${v.name})`)
      .join("; "),
    "and segment revenue (by product line, brand, region or customer).",
    'JSON shape: {"currency": "<ISO code of the figures, e.g. HKD>", "periods": [{"periodEnd": "YYYY-MM (fiscal year end month)", "lines": [{"line": "<canonical key>", "printed": "<the figure exactly as printed, e.g. (12,345) or 808,417>", "unit": "one|thousand|million|billion (from the column header, e.g. HK$\'000 = thousand)", "page": <PDF page number>, "label": "<the row label as printed>"}]}], "segments": [{"periodEnd": "YYYY-MM", "axis": "product|region|customer", "name": "<segment name>", "printed": "...", "unit": "...", "page": <n>}]}',
    "Only figures printed on these pages. EPS: unit one, in the currency per share. Shares: unit one (or thousand when the header says so). Skip a line you cannot find.",
    "",
    ...pages.map((p) => `=== PDF page ${p.page} ===\n${p.text}`),
  ].join("\n");

const UNIT: Record<string, number> = { one: 1, thousand: 1e3, million: 1e6, billion: 1e9 };

/** "(12,345)" -> -12345; "808,417" -> 808417; "—" -> null. */
export function parsePrinted(printed: string): number | null {
  const s = printed.trim();
  const negative = /^\(.*\)$/.test(s) || /^[-−–]\s*\d/.test(s);
  const n = parseNumber(s.replace(/[()−–]/g, "").replace(/^-/, "").replace(/[^\d.,-]/g, ""));
  return n === null ? null : negative ? -n : n;
}

async function latestAnnualReport(ctx: SourceContext, symbol: string) {
  if (!ctx.db) return null;
  const rows = await ctx.db
    .select({ title: gold.filings.title, url: gold.filings.url, filedAt: gold.filings.filedAt })
    .from(gold.filings)
    .where(eq(gold.filings.symbol, symbol))
    .orderBy(desc(gold.filings.filedAt));
  return rows.find((r) => r.url?.endsWith(".pdf") && /^annual report( \d{4}(\/\d{2,4})?)?$/i.test(r.title.trim())) ?? null;
}

export const pdfExtract: FinancialsSource = {
  name: "pdf-extract",
  publisher: "Annual report PDF read by Claude (Hong Kong), every value cites its page: an extraction, not published data",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: isMarket("HK"),
  async fetch(symbol, ctx) {
    const report = await latestAnnualReport(ctx, symbol);
    if (!report?.url) return { request: { symbol }, httpStatus: null, error: "no annual report PDF among the collected filings" };
    // One extraction per document and prompt version: a later run reuses it.
    const [prior] = ctx.db
      ? await ctx.db.select({ id: fetches.id, payload: fetches.payload }).from(fetches).where(and(eq(fetches.dimension, "financials"), eq(fetches.source, "pdf-extract"), eq(fetches.subject, symbol), isNull(fetches.error))).orderBy(desc(fetches.fetchedAt)).limit(1)
      : [];
    const priorPayload = prior?.payload as PdfPayload | undefined;
    if (priorPayload?.document.url === report.url && priorPayload.version === PDF_EXTRACT_VERSION) return { request: { url: report.url, reusedFrom: prior.id }, httpStatus: 200, payload: priorPayload };
    if (!ctx.complete) return { request: { url: report.url }, httpStatus: null, error: "no LLM in this context" };
    const res = await ctx.fetch(report.url, { headers: BROWSER_HEADERS });
    if (!res.ok) return { request: { url: report.url }, httpStatus: res.status, error: `annual report PDF: HTTP ${res.status}` };
    const { pdfPages } = (await nodeImport(new URL("./pdf-text.ts", import.meta.url).href)) as typeof import("./pdf-text");
    const pages = pickPages(await pdfPages(new Uint8Array(await res.arrayBuffer())));
    if (pages.length === 0) return { request: { url: report.url }, httpStatus: 200, error: "no statement page found in the PDF text" };
    const answer = await ctx.complete({ system: PDF_SYSTEM, prompt: pdfPrompt(report.title, pages) });
    const { firstJsonObject } = await import("@/llm/judge");
    const extraction = JSON.parse(firstJsonObject(answer.text)) as PdfExtraction;
    const payload: PdfPayload = { version: PDF_EXTRACT_VERSION, document: { title: report.title, url: report.url, filedAt: report.filedAt.toISOString() }, pages, extraction, model: answer.model };
    return { request: { url: report.url, pages: pages.map((p) => p.page), version: PDF_EXTRACT_VERSION }, httpStatus: 200, payload };
  },
  extract(payload) {
    const p = payload as PdfPayload;
    const currency = p.extraction.currency ?? null;
    const pageText = new Map(p.pages.map((x) => [x.page, x.text]));
    const out: LineReading[] = [];
    // A figure is kept only when it is printed on the page it cites: Claude copies, never invents.
    const onPage = (printed: string, page: number) => (pageText.get(page) ?? "").replace(/\s+/g, "").includes(printed.replace(/\s+/g, ""));
    for (const period of p.extraction.periods ?? []) {
      if (!/^\d{4}-\d{2}$/.test(period.periodEnd)) continue;
      for (const l of period.lines ?? []) {
        const v = parsePrinted(l.printed);
        const scale = UNIT[l.unit] ?? null;
        if (v === null || scale === null || !isLineKey(l.line) || LINES[l.line].statement === "market" || !onPage(l.printed, l.page)) continue;
        out.push(reading({ periodType: "year", periodEnd: period.periodEnd, line: l.line, value: v * scale, currency, label: l.label, consolidated: true, citation: { document: p.document.title, url: p.document.url, page: l.page, quote: l.printed } }));
      }
    }
    for (const s of p.extraction.segments ?? []) {
      const v = parsePrinted(s.printed);
      const scale = UNIT[s.unit] ?? null;
      if (v === null || scale === null || !/^\d{4}-\d{2}$/.test(s.periodEnd) || !["product", "region", "customer"].includes(s.axis) || !onPage(s.printed, s.page)) continue;
      out.push({ periodType: "year", periodEnd: s.periodEnd, line: segmentLine(s.axis, s.name), value: v * scale, currency, label: s.name, consolidated: true, citation: { document: p.document.title, url: p.document.url, page: s.page, quote: s.printed } });
    }
    // One value per (period, line): the first page cited (the summary / statement before the notes).
    const seen = new Map<string, LineReading>();
    for (const r of out) if (!seen.has(`${r.periodEnd}|${r.line}`)) seen.set(`${r.periodEnd}|${r.line}`, r);
    return [...seen.values()];
  },
};

/** Run order = trust order when values disagree and no majority exists: registries first, Yahoo, then extraction. */
export const FINANCIALS_SOURCES = [secFilings, secCompanyFacts, dart, edinetFinancials, yahoo, yahooChart, pdfExtract] as const;
export const FINANCIALS_PRIORITY = FINANCIALS_SOURCES.map((s) => s.name);
