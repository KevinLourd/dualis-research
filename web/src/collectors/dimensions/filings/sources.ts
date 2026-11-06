import type { FetchOutcome, Source } from "../../types";
import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, SEC_HEADERS, companiesHouseNumber, dartCorpCode, daysAgo, isMarket, isoDate, memo, tickerBase } from "../../markets";

export type FilingItem = {
  registry: string;
  filingKey: string;
  form: string | null;
  title: string;
  filedAt: Date;
  url: string | null;
  language: string;
};

/** A filings source = how to fetch one ticker's recent filings + how to read them out of the raw answer. */
export type FilingSource = Source & {
  /** Human name of the registry, for the console's "where this comes from". */
  registryName: string;
  extract: (payload: unknown, subject: string) => FilingItem[];
};

const withError = (out: FetchOutcome, error: string | null): FetchOutcome => (error && !out.error ? { ...out, error } : out);

/** Local exchange time to an instant: "2026-09-08 14:46" at +09:00. */
const at = (local: string, offset: string) => new Date(`${local.trim().replace(" ", "T")}${local.length <= 10 ? "T00:00" : ""}${offset}`);

/** How many recent SEC filings land in bronze per ticker (a large filer's full history is megabytes). */
export const SEC_RECENT_LIMIT = 200;

/** SEC EDGAR submissions: every US filing (10-K, 10-Q, 8-K, Form 4, proxy...). No key, needs a contact User-Agent. */
export const secEdgar: FilingSource = {
  name: "sec-edgar",
  registryName: "SEC EDGAR",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const ciks = await memo(ctx, "sec-ciks", async () => {
      const res = await ctx.fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
      if (!res.ok) throw new Error(`SEC ticker map: HTTP ${res.status}`);
      const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
      return new Map(Object.values(raw).map((v) => [v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0")]));
    });
    const cik = ciks.get(symbol.toUpperCase().replace(".", "-"));
    if (!cik) return { request: { symbol }, httpStatus: null, error: "Not an SEC filer (ticker absent from SEC's company_tickers.json)" };
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const out = await getJson(ctx, url, { url, cik, trimmed: `first ${SEC_RECENT_LIMIT} recent filings` }, { headers: SEC_HEADERS });
    if (out.error) return out;
    const p = out.payload as { cik: string; name: string; filings: { recent: Record<string, unknown[]> } };
    const recent = Object.fromEntries(Object.entries(p.filings.recent).map(([k, v]) => [k, v.slice(0, SEC_RECENT_LIMIT)]));
    return { ...out, payload: { cik: p.cik, name: p.name, filings: { recent } } };
  },
  extract(payload) {
    const p = payload as { cik: string; filings: { recent: Record<string, string[]> } };
    const r = p.filings.recent;
    const cik = Number(p.cik);
    return r.accessionNumber.map((acc, i) => ({
      registry: "sec",
      filingKey: acc,
      form: r.form[i],
      title: secTitle(r.form[i], r.primaryDocDescription?.[i], r.items?.[i]),
      filedAt: new Date(r.acceptanceDateTime?.[i] || `${r.filingDate[i]}T00:00:00Z`),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${r.primaryDocument[i]}`,
      language: "en",
    }));
  },
};

const SEC_8K_ITEMS: Record<string, string> = {
  "1.01": "material agreement",
  "1.02": "agreement terminated",
  "2.01": "acquisition or disposal",
  "2.02": "results of operations",
  "2.03": "new debt",
  "2.05": "restructuring costs",
  "2.06": "impairment",
  "3.01": "listing notice",
  "3.02": "unregistered share sale",
  "4.01": "auditor change",
  "5.02": "officer or director change",
  "5.03": "bylaws change",
  "5.07": "shareholder vote",
  "7.01": "Regulation FD disclosure",
  "8.01": "other events",
};
const SEC_FORMS: Record<string, string> = {
  "10-K": "Annual report",
  "10-Q": "Quarterly report",
  "8-K": "Current report",
  "4": "Insider transaction",
  "3": "Initial insider ownership",
  "DEF 14A": "Proxy statement",
  "SC 13G": "Large holder (passive)",
  "SC 13D": "Large holder (active)",
  "SC 13G/A": "Large holder (passive), amended",
  "SC 13D/A": "Large holder (active), amended",
  "SCHEDULE 13G": "Large holder (passive)",
  "SCHEDULE 13G/A": "Large holder (passive), amended",
  "SCHEDULE 13D": "Large holder (active)",
  "SCHEDULE 13D/A": "Large holder (active), amended",
  "10-K/A": "Annual report, amended",
  "10-Q/A": "Quarterly report, amended",
  "8-K/A": "Current report, amended",
  "144": "Planned insider sale",
  S1: "Registration",
};

/** "8-K" + items "2.02,9.01" -> "Current report: results of operations". */
export function secTitle(form: string, description: string | undefined, items: string | undefined): string {
  const base = SEC_FORMS[form] ?? (description && description.toUpperCase() !== form.toUpperCase() ? description : form);
  const named = (items ?? "")
    .split(",")
    .map((i) => SEC_8K_ITEMS[i.trim()])
    .filter(Boolean);
  return named.length ? `${base}: ${named.join(", ")}` : base;
}

/** TDnet timely disclosures through the yanoshin web API (a free mirror of TDnet by company code). No key. */
export const tdnet: FilingSource = {
  name: "tdnet",
  registryName: "TDnet (Tokyo Stock Exchange)",
  requiredEnv: [],
  covers: isMarket("JP"),
  async fetch(symbol, ctx) {
    const url = `https://webapi.yanoshin.jp/webapi/tdnet/list/${encodeURIComponent(tickerBase(symbol))}.json?limit=100`;
    const out = await getJson(ctx, url, { url });
    return withError(out, Array.isArray((out.payload as { items?: unknown[] })?.items) ? null : "TDnet mirror returned no item list");
  },
  extract(payload) {
    const items = (payload as { items: { Tdnet: Record<string, string> }[] }).items;
    return items.map(({ Tdnet: t }) => ({
      registry: "tdnet",
      filingKey: t.id,
      form: null,
      title: t.title,
      filedAt: at(t.pubdate, "+09:00"),
      url: t.document_url ? t.document_url.replace(/^https:\/\/webapi\.yanoshin\.jp\/rd\.php\?/, "") : null,
      language: "ja",
    }));
  },
};

/** How many past days the EDINET source scans each run (EDINET lists filings by day, not by company). */
export const EDINET_DAYS = 14;

/** EDINET (Japan FSA): statutory reports (annual, quarterly, large holdings). Free key. */
export const edinet: FilingSource = {
  name: "edinet",
  registryName: "EDINET (Japan FSA)",
  requiredEnv: ["EDINET_API_KEY"],
  covers: isMarket("JP"),
  async fetch(symbol, ctx) {
    const secCode = `${tickerBase(symbol)}0`;
    const dates = Array.from({ length: EDINET_DAYS }, (_, i) => isoDate(daysAgo(i)));
    const matches: unknown[] = [];
    for (const date of dates) {
      const day = await memo(ctx, `edinet:${date}`, async () => {
        const res = await ctx.fetch(`https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2&Subscription-Key=${ctx.env.EDINET_API_KEY}`);
        if (!res.ok) throw new Error(`EDINET ${date}: HTTP ${res.status}`);
        const body = (await res.json()) as { results?: Record<string, unknown>[]; metadata?: { message?: string } };
        if (!body.results) throw new Error(`EDINET ${date}: ${body.metadata?.message ?? "no results"}`);
        return body.results;
      });
      matches.push(...day.filter((d) => d.secCode === secCode));
    }
    return {
      request: { url: "https://api.edinet-fsa.go.jp/api/v2/documents.json", dates: [dates.at(-1), dates[0]], secCode, kept: "documents of this company only" },
      httpStatus: 200,
      payload: { secCode, documents: matches },
    };
  },
  extract(payload) {
    const docs = (payload as { documents: Record<string, string>[] }).documents;
    return docs
      .filter((d) => d.withdrawalStatus === "0")
      .map((d) => ({
        registry: "edinet",
        filingKey: d.docID,
        form: d.docTypeCode,
        title: d.docDescription,
        filedAt: at(d.submitDateTime, "+09:00"),
        url: `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${d.docID}.pdf`,
        language: "ja",
      }));
  },
};

/** OpenDART disclosure list (Korea FSS): one year of filings. Free key. */
export const dart: FilingSource = {
  name: "dart",
  registryName: "DART (Korea FSS)",
  requiredEnv: ["DART_API_KEY"],
  covers: (symbol) => isMarket("KR")(symbol) && dartCorpCode(symbol) !== null,
  async fetch(symbol, ctx) {
    const q = `corp_code=${dartCorpCode(symbol)}&bgn_de=${isoDate(daysAgo(365)).replace(/-/g, "")}&page_count=100`;
    const out = await getJson(ctx, `https://opendart.fss.or.kr/api/list.json?${q}&crtfc_key=${ctx.env.DART_API_KEY}`, {
      url: `https://opendart.fss.or.kr/api/list.json?${q}`,
    });
    const status = (out.payload as { status?: string })?.status;
    // 013 = "no data": a valid answer, the company filed nothing in the window.
    return withError(out, status === "000" || status === "013" ? null : `DART status ${status}`);
  },
  extract(payload) {
    const list = (payload as { list?: Record<string, string>[] }).list ?? [];
    return list.map((f) => ({
      registry: "dart",
      filingKey: f.rcept_no,
      form: null,
      title: f.report_nm.trim(),
      filedAt: at(`${f.rcept_dt.slice(0, 4)}-${f.rcept_dt.slice(4, 6)}-${f.rcept_dt.slice(6, 8)}`, "+09:00"),
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${f.rcept_no}`,
      language: "ko",
    }));
  },
};

/** Companies House filing history (UK register): accounts, officers, shares. Free key. */
export const companiesHouse: FilingSource = {
  name: "companies-house",
  registryName: "Companies House (UK)",
  requiredEnv: ["COMPANIES_HOUSE_API_KEY"],
  covers: (symbol) => companiesHouseNumber(symbol) !== null,
  async fetch(symbol, ctx) {
    const url = `https://api.company-information.service.gov.uk/company/${companiesHouseNumber(symbol)}/filing-history?items_per_page=100`;
    return getJson(ctx, url, { url }, { headers: { Authorization: `Basic ${btoa(`${ctx.env.COMPANIES_HOUSE_API_KEY}:`)}` } });
  },
  extract(payload, symbol) {
    const items = (payload as { items?: Record<string, string>[] }).items ?? [];
    const num = companiesHouseNumber(symbol);
    return items.map((f) => ({
      registry: "companies-house",
      filingKey: f.transaction_id,
      form: f.type,
      title: chTitle(f.description, f.category),
      filedAt: at(f.date, "+00:00"),
      url: `https://find-and-update.company-information.service.gov.uk/company/${num}/filing-history/${f.transaction_id}/document?format=pdf&download=0`,
      language: "en",
    }));
  },
};

/** "accounts-with-accounts-type-group" -> "Accounts with accounts type group". */
export function chTitle(description: string | undefined, category: string | undefined): string {
  const text = (description || category || "filing").replace(/-/g, " ");
  return text[0].toUpperCase() + text.slice(1);
}

/** HKEXnews title search (the exchange's own announcements site). No key; needs the issuer's HKEX stock id. */
export const hkexnews: FilingSource = {
  name: "hkexnews",
  registryName: "HKEXnews",
  requiredEnv: [],
  covers: isMarket("HK"),
  async fetch(symbol, ctx) {
    const code = tickerBase(symbol).padStart(5, "0");
    const prefixUrl = `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=EN&type=A&name=${code}&market=SEHK`;
    const res = await ctx.fetch(prefixUrl, { headers: BROWSER_HEADERS });
    const text = await res.text();
    const json = JSON.parse(text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "")) as { stockInfo?: { stockId: number; code: string }[] };
    const stockId = json.stockInfo?.find((s) => s.code === code)?.stockId;
    if (!stockId) return { request: { url: prefixUrl }, httpStatus: res.status, payloadText: text, error: `HKEXnews has no stock id for ${code}` };
    const from = isoDate(daysAgo(365)).replace(/-/g, "");
    const to = isoDate(new Date()).replace(/-/g, "");
    const url = `https://www1.hkexnews.hk/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK&stockId=${stockId}&documentType=-1&fromDate=${from}&toDate=${to}&title=&searchType=0&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=200&lang=E`;
    const out = await getJson(ctx, url, { url, stockId }, { headers: BROWSER_HEADERS });
    return withError(out, typeof (out.payload as { result?: unknown })?.result === "string" ? null : "HKEXnews returned no result list");
  },
  extract(payload) {
    const raw = (payload as { result: string }).result;
    const rows = (raw === "null" ? [] : JSON.parse(raw)) as Record<string, string>[];
    return rows.map((r) => {
      const [d, m, y] = r.DATE_TIME.slice(0, 10).split("/");
      return {
        registry: "hkex",
        filingKey: r.NEWS_ID,
        form: r.LONG_TEXT || null,
        title: r.TITLE,
        filedAt: at(`${y}-${m}-${d} ${r.DATE_TIME.slice(11)}`, "+08:00"),
        url: `https://www1.hkexnews.hk${r.FILE_LINK}`,
        language: "en",
      };
    });
  },
};

/** ASX company announcements (the exchange's own research API). No key. */
export const asx: FilingSource = {
  name: "asx",
  registryName: "ASX announcements",
  requiredEnv: [],
  covers: isMarket("AU"),
  async fetch(symbol, ctx) {
    const url = `https://asx.api.markitdigital.com/asx-research/1.0/companies/${encodeURIComponent(tickerBase(symbol))}/announcements`;
    const out = await getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
    return withError(out, Array.isArray((out.payload as { data?: { items?: unknown } })?.data?.items) ? null : "ASX returned no announcement list");
  },
  extract(payload, symbol) {
    const items = (payload as { data: { items: Record<string, string>[] } }).data.items;
    return items.map((a) => ({
      registry: "asx",
      filingKey: a.documentKey,
      form: a.announcementType,
      title: a.headline,
      filedAt: new Date(a.date),
      url: `https://www.asx.com.au/markets/trade-our-cash-market/announcements.${tickerBase(symbol).toLowerCase()}`,
      language: "en",
    }));
  },
};

export const FILING_SOURCES = [secEdgar, tdnet, edinet, dart, companiesHouse, hkexnews, asx] as const;

/** Markets no free filings source answers today, said out loud in the console. */
export const FILINGS_NOT_COVERED: Record<string, string> = {
  CA: "Canada's SEDAR+ has no free API.",
  EU: "Europe has no single free filings register.",
};

