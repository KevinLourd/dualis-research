import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, isMarket, memo, tickerBase } from "../../markets";
import type { FetchOutcome, Source, SourceContext } from "../../types";
import { parseNumber } from "../company-profile/sources";
import { extractFinnhubEarnings, fetchFinnhubEarnings, MONTHS } from "../earnings/sources";

/**
 * Analyst consensus vs actuals ("KPIs vs market expectations"), free sources only.
 * One reading = one (period, metric) as a source reports it: the consensus range (low / mean / high, number of
 * analysts) and/or the reported actual. Never an estimate of ours: a stat no source publishes stays empty.
 */
export const CONSENSUS_METRICS = ["revenue", "ebitda", "operating-income", "net-income", "eps"] as const;
export type ConsensusMetric = (typeof CONSENSUS_METRICS)[number];
export type PeriodType = "quarter" | "year";
export const CONSENSUS_STATS = ["low", "mean", "high", "analysts", "actual", "currency"] as const;
export type ConsensusStat = (typeof CONSENSUS_STATS)[number];

/** `periodEnd` = fiscal period end month, "YYYY-MM". */
export type ConsensusReading = {
  periodType: PeriodType;
  periodEnd: string;
  metric: ConsensusMetric;
  values: Partial<Record<ConsensusStat, number | string | null>>;
};

export type ConsensusSource = Source & {
  /** Markets the source answers, said on the Data page. */
  markets: string;
  extract: (payload: unknown) => ConsensusReading[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const month = (d: string) => d.slice(0, 7);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------- Yahoo quoteSummary: earningsTrend (consensus) + earningsHistory (EPS actual vs estimate) ----------

/** Yahoo answers 429 to browser-style headers and 200 to this plain client (same as the price source). */
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (dualis-collector)" };

type YahooSession = { cookie: string; crumb: string | null; error: string | null };

/** quoteSummary needs a crumb tied to Yahoo's A3 cookie: one handshake per run. */
function yahooSession(ctx: SourceContext): Promise<YahooSession> {
  return memo(ctx, "yahoo-crumb", async () => {
    const home = await ctx.fetch("https://fc.yahoo.com", { headers: YAHOO_HEADERS, redirect: "manual" });
    await home.text();
    const cookie = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const res = await ctx.fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...YAHOO_HEADERS, ...(cookie ? { Cookie: cookie } : {}) } });
    const crumb = (await res.text()).trim();
    if (!res.ok || !crumb || crumb.includes(" ")) return { cookie, crumb: null, error: `Yahoo refused a crumb: HTTP ${res.status} ${crumb.slice(0, 80)}` };
    return { cookie, crumb, error: null };
  });
}

type Raw = { raw?: number } | undefined;
type YahooEstimate = { avg?: Raw; low?: Raw; high?: Raw; numberOfAnalysts?: Raw; earningsCurrency?: string; revenueCurrency?: string };
type YahooTrend = { period: string; endDate?: string | null; earningsEstimate?: YahooEstimate; revenueEstimate?: YahooEstimate };
type YahooHistory = { quarter?: { raw?: number; fmt?: string }; epsActual?: Raw; epsEstimate?: Raw; currency?: string };
type YahooSummary = { quoteSummary?: { result?: { earningsTrend?: { trend?: YahooTrend[] }; earningsHistory?: { history?: YahooHistory[] } }[] | null } };

/** One Yahoo estimate block -> a reading, only when at least one analyst stands behind it (Yahoo pads with zeros). */
function yahooEstimate(periodType: PeriodType, periodEnd: string, metric: ConsensusMetric, e: YahooEstimate | undefined, currency: string | undefined): ConsensusReading | null {
  const analysts = num(e?.numberOfAnalysts?.raw);
  const mean = num(e?.avg?.raw);
  if (!analysts || mean === null) return null;
  return { periodType, periodEnd, metric, values: { low: num(e?.low?.raw), mean, high: num(e?.high?.raw), analysts, currency: currency ?? null } };
}

export const yahoo: ConsensusSource = {
  name: "yahoo",
  markets: "every market (when analysts cover the company)",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const session = await yahooSession(ctx);
    const path = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earningsTrend,earningsHistory`;
    if (!session.crumb) return { request: { url: path }, httpStatus: null, error: session.error ?? "Yahoo gave no crumb" };
    const headers = { ...YAHOO_HEADERS, ...(session.cookie ? { Cookie: session.cookie } : {}) };
    const url = `${path}&crumb=${encodeURIComponent(session.crumb)}`;
    if (!process.env.VITEST) await sleep(400);
    let out = await getJson(ctx, url, { url: path }, { headers });
    for (const pause of process.env.VITEST ? [] : [5_000, 20_000]) {
      if (out.httpStatus !== 429) break;
      await sleep(pause);
      out = await getJson(ctx, url, { url: path, retried: true }, { headers });
    }
    if (!out.error && !(out.payload as YahooSummary)?.quoteSummary?.result?.[0]) return { ...out, error: "Yahoo returned no summary for this symbol" };
    return out;
  },
  extract(payload) {
    const r = (payload as YahooSummary).quoteSummary!.result![0];
    const out: ConsensusReading[] = [];
    for (const t of r.earningsTrend?.trend ?? []) {
      const periodType: PeriodType | null = /^[0+]1?q$/.test(t.period) ? "quarter" : /^[0+]1?y$/.test(t.period) ? "year" : null;
      if (!periodType || !t.endDate) continue;
      const end = month(t.endDate);
      const eps = yahooEstimate(periodType, end, "eps", t.earningsEstimate, t.earningsEstimate?.earningsCurrency);
      const revenue = yahooEstimate(periodType, end, "revenue", t.revenueEstimate, t.revenueEstimate?.revenueCurrency);
      if (eps) out.push(eps);
      if (revenue) out.push(revenue);
    }
    for (const h of r.earningsHistory?.history ?? []) {
      if (!h.quarter?.fmt) continue;
      const actual = num(h.epsActual?.raw);
      const estimate = num(h.epsEstimate?.raw);
      if (actual === null && estimate === null) continue;
      out.push({ periodType: "quarter", periodEnd: month(h.quarter.fmt), metric: "eps", values: { actual, mean: estimate, currency: h.currency ?? null } });
    }
    return out;
  },
};

// ---------- Yahoo fundamentals-timeseries: reported actuals, every market ----------

const FUNDAMENTAL_TYPES: Record<string, ConsensusMetric> = {
  TotalRevenue: "revenue",
  EBITDA: "ebitda",
  OperatingIncome: "operating-income",
  NetIncome: "net-income",
  DilutedEPS: "eps",
};

type TimeseriesRow = { asOfDate?: string; currencyCode?: string; reportedValue?: { raw?: number } } | null;

export const yahooFundamentals: ConsensusSource = {
  name: "yahoo-fundamentals",
  markets: "every market (reported actuals only)",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const types = Object.keys(FUNDAMENTAL_TYPES).flatMap((t) => [`quarterly${t}`, `annual${t}`]).join(",");
    const p1 = Math.floor(Date.UTC(new Date().getUTCFullYear() - 5, 0, 1) / 1000);
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types}&period1=${p1}&period2=${Math.floor(Date.now() / 1000)}`;
    if (!process.env.VITEST) await sleep(400);
    return getJson(ctx, url, { url }, { headers: YAHOO_HEADERS });
  },
  extract(payload) {
    const results = (payload as { timeseries?: { result?: Record<string, unknown>[] } })?.timeseries?.result ?? [];
    const out: ConsensusReading[] = [];
    for (const r of results) {
      const type = (r.meta as { type?: string[] })?.type?.[0];
      if (!type) continue;
      const periodType: PeriodType | null = type.startsWith("annual") ? "year" : type.startsWith("quarterly") ? "quarter" : null;
      const metric = FUNDAMENTAL_TYPES[type.replace(/^(annual|quarterly)/, "")];
      if (!periodType || !metric) continue;
      for (const row of (r[type] as TimeseriesRow[] | undefined) ?? []) {
        const actual = num(row?.reportedValue?.raw);
        if (!row?.asOfDate || actual === null) continue;
        out.push({ periodType, periodEnd: month(row.asOfDate), metric, values: { actual, currency: row.currencyCode ?? null } });
      }
    }
    return out;
  },
};

// ---------- Nasdaq analyst earnings forecast (Zacks): EPS low / mean / high / count, US ----------

type NasdaqForecastRow = { fiscalEnd: string; consensusEPSForecast: unknown; highEPSForecast: unknown; lowEPSForecast: unknown; noOfEstimates: unknown };

/** "Dec 2026" -> "2026-12". */
const nasdaqMonth = (v: string) => {
  const [mon, year] = v.split(" ");
  const m = MONTHS.indexOf(mon);
  return m === -1 || !/^\d{4}$/.test(year ?? "") ? null : `${year}-${String(m + 1).padStart(2, "0")}`;
};

export const nasdaq: ConsensusSource = {
  name: "nasdaq",
  markets: "US",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const url = `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/earnings-forecast`;
    return getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
  },
  extract(payload) {
    const d = (payload as { data?: { quarterlyForecast?: { rows?: NasdaqForecastRow[] | null }; yearlyForecast?: { rows?: NasdaqForecastRow[] | null } } | null }).data;
    const out: ConsensusReading[] = [];
    const add = (periodType: PeriodType, rows: NasdaqForecastRow[] | null | undefined) => {
      for (const r of rows ?? []) {
        const end = nasdaqMonth(String(r.fiscalEnd));
        const mean = parseNumber(r.consensusEPSForecast);
        const analysts = parseNumber(r.noOfEstimates);
        if (!end || mean === null || !analysts) continue;
        out.push({ periodType, periodEnd: end, metric: "eps", values: { mean, low: parseNumber(r.lowEPSForecast), high: parseNumber(r.highEPSForecast), analysts, currency: "USD" } });
      }
    };
    add("quarter", d?.quarterlyForecast?.rows);
    add("year", d?.yearlyForecast?.rows);
    return out;
  },
};

// ---------- Finnhub (free tier): earnings calendar = EPS + revenue mean estimate and actual per quarter, US ----------

export const finnhub: ConsensusSource = {
  name: "finnhub",
  markets: "US",
  requiredEnv: ["FINNHUB_API_KEY"],
  covers: isUsSymbol,
  fetch: (symbol, ctx) => fetchFinnhubEarnings(symbol, ctx),
  extract(payload) {
    const out: ConsensusReading[] = [];
    for (const item of extractFinnhubEarnings(payload)) {
      const v = item.values;
      const eps = { mean: num(v.epsEstimate), actual: num(v.epsActual) };
      const revenue = { mean: num(v.revenueEstimate), actual: num(v.revenueActual) };
      if (eps.mean !== null || eps.actual !== null) out.push({ periodType: "quarter", periodEnd: item.period, metric: "eps", values: eps });
      if (revenue.mean !== null || revenue.actual !== null) out.push({ periodType: "quarter", periodEnd: item.period, metric: "revenue", values: revenue });
    }
    return out;
  },
};

// ---------- Naver Finance (FnGuide consensus): Korea, annual + quarterly ----------

/** Naver row titles -> metric. Amounts are in 억원 (100 million won), EPS in won. */
const NAVER_ROWS: Record<string, ConsensusMetric> = { 매출액: "revenue", 영업이익: "operating-income", 당기순이익: "net-income", EPS: "eps" };
type NaverFinance = { financeInfo?: { trTitleList?: { isConsensus: string; key: string }[]; rowList?: { title: string; columns: Record<string, { value?: string }> }[] } };

export const naver: ConsensusSource = {
  name: "naver",
  markets: "Korea",
  requiredEnv: [],
  covers: isMarket("KR"),
  async fetch(symbol, ctx): Promise<FetchOutcome> {
    const base = `https://m.stock.naver.com/api/stock/${encodeURIComponent(tickerBase(symbol))}/finance`;
    const annual = await getJson(ctx, `${base}/annual`, { url: `${base}/annual` }, { headers: BROWSER_HEADERS });
    if (annual.error) return annual;
    const quarter = await getJson(ctx, `${base}/quarter`, { url: `${base}/quarter` }, { headers: BROWSER_HEADERS });
    return {
      request: { urls: [`${base}/annual`, `${base}/quarter`] },
      httpStatus: quarter.httpStatus,
      payload: { annual: annual.payload, quarter: quarter.payload ?? quarter.payloadText },
      ...(quarter.error ? { error: quarter.error } : {}),
    };
  },
  extract(payload) {
    const p = payload as { annual: NaverFinance; quarter: NaverFinance };
    const out: ConsensusReading[] = [];
    for (const [periodType, f] of [["year", p.annual], ["quarter", p.quarter]] as const) {
      for (const col of f.financeInfo?.trTitleList ?? []) {
        if (!/^\d{6}$/.test(col.key)) continue;
        const periodEnd = `${col.key.slice(0, 4)}-${col.key.slice(4)}`;
        for (const row of f.financeInfo?.rowList ?? []) {
          const metric = NAVER_ROWS[row.title];
          const value = parseNumber(row.columns[col.key]?.value);
          if (!metric || value === null) continue;
          const scaled = metric === "eps" ? value : value * 1e8;
          out.push({ periodType, periodEnd, metric, values: { [col.isConsensus === "Y" ? "mean" : "actual"]: scaled, currency: "KRW" } });
        }
      }
    }
    return out;
  },
};

/**
 * Run order = gold priority when sources disagree and no majority exists: the two street feeds first (Zacks via
 * Nasdaq, Yahoo), then Finnhub's mean-only calendar, Naver for Korea, and GAAP actuals from Yahoo fundamentals last
 * (street "actual" EPS is adjusted, the comparable figure to the consensus).
 */
export const CONSENSUS_SOURCES = [yahoo, nasdaq, finnhub, naver, yahooFundamentals] as const;

/**
 * Searched and not free (2026-11-05): Finnhub eps/revenue/ebitda-estimate endpoints answer 403 on the free key;
 * FMP analyst-estimates (the only free EBITDA / net income consensus) answers 402 on the free key for anything but a
 * few mega caps (MNRO refused, AAPL served); Koyfin has no export. So EBITDA and net income carry actuals only
 * (Naver adds operating income and net income consensus for Korea).
 */
export const CONSENSUS_NOT_COVERED = "No free source publishes analyst estimates for this market.";
