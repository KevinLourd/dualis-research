import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import { filings } from "@/db/schema/silver";
import type { FetchOutcome, Source, SourceContext } from "../../types";
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

/**
 * Every registry is read 5 years back (Kevin 2026-11-19): a driver is found from the significant price moves of the
 * last years, and a move is explained only by the filings around it. Before, one year (SEC: the last 200 filings,
 * October 2023 for CareCloud): 2,473 of 3,056 moves had no document to read.
 */
export const FILINGS_HISTORY_YEARS = 5;
export const historyStart = (now = new Date()) => daysAgo(Math.round(FILINGS_HISTORY_YEARS * 365.25), now);
const compact = (d: Date) => isoDate(d).replace(/-/g, "");
/** Pages a paginated registry is read for, per ticker and run (100 filings each): a bound, said in the answer. */
export const MAX_HISTORY_PAGES = 15;

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
    const since = isoDate(historyStart());
    const out = await getJson(ctx, url, { url, cik, trimmed: `filings since ${since}` }, { headers: SEC_HEADERS });
    if (out.error) return out;
    const p = out.payload as { cik: string; name: string; filings: { recent: Record<string, unknown[]> } };
    // `recent` holds up to 1,000 filings, newest first: keep the ones of the last 5 years.
    const keep = (p.filings.recent.filingDate as string[]).filter((d) => d >= since).length;
    const recent = Object.fromEntries(Object.entries(p.filings.recent).map(([k, v]) => [k, v.slice(0, keep)]));
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
    // The mirror keeps TDnet's list back to 2009 (Miraial: 289 items); the PDFs themselves expire after ~1 month.
    const url = `https://webapi.yanoshin.jp/webapi/tdnet/list/${encodeURIComponent(tickerBase(symbol))}.json?limit=500`;
    const out = await getJson(ctx, url, { url });
    if (out.error) return out;
    const items = (out.payload as { items?: { Tdnet: { pubdate: string } }[] })?.items;
    if (!Array.isArray(items)) return withError(out, "TDnet mirror returned no item list");
    const since = isoDate(historyStart());
    return { ...out, payload: { items: items.filter((i) => i.Tdnet.pubdate.slice(0, 10) >= since) } };
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
/** Years of statutory reports we look for (the documents dimension reads 5). */
export const EDINET_HISTORY_YEARS = 5;
/** Past EDINET day lists one run may read for the history, all tickers together (~0.4 s each): a ticker's 5 years take
 * ~300, so the backlog drains in a run or two and later runs read only the windows of new 決算短信. */
export const EDINET_HISTORY_DAYS_PER_RUN = 400;
/** Statutory periodic reports: 有価証券報告書 (120), 四半期報告書 (140, abolished for periods from April 2024), 半期報告書 (160). */
const EDINET_PERIODIC = new Set(["120", "140", "160"]);

type EdinetDay = Record<string, string>[];
export type HistoryWindow = { anchor: string; dates: string[]; complete: boolean };

/** A day in Tokyo: "2026-03-09" for 2026-03-09T05:00Z. */
const tokyoDate = (d: Date) => isoDate(new Date(d.getTime() + 9 * 3_600_000));

/**
 * Where a company's statutory reports sit on EDINET's day lists: after each TDnet 決算短信 (the results summary the
 * exchange gets first). The quarterly / half-year report follows within days (Miraial: 1 to 3), the annual securities
 * report before the general meeting, 6 to 8 weeks later (Miraial 2026: 44 days). One window per summary, newest first;
 * corrections (訂正) are no anchor. `complete` = every day of it is past, so a scan of it never needs redoing.
 */
export function edinetHistoryWindows(summaries: { filingKey: string; title: string; filedAt: Date }[], now = new Date()): HistoryWindow[] {
  const today = tokyoDate(now);
  return summaries
    .filter((s) => /決算短信/.test(s.title) && !/訂正/.test(s.title))
    .sort((a, b) => b.filedAt.getTime() - a.filedAt.getTime())
    .map((s) => {
      const annual = !/四半期|中間|半期/.test(s.title.normalize("NFKC"));
      const first = new Date(`${tokyoDate(s.filedAt)}T00:00:00Z`);
      const all = Array.from({ length: (annual ? 75 : 30) + 1 }, (_, i) => isoDate(new Date(first.getTime() + i * 86_400_000)));
      return { anchor: s.filingKey, dates: all.filter((d) => d <= today), complete: all.at(-1)! < today };
    });
}

/** One EDINET day list, read once per run whatever the ticker. */
const edinetDay = (ctx: SourceContext, date: string): Promise<EdinetDay> =>
  memo(ctx, `edinet:${date}`, async () => {
    const res = await ctx.fetch(`https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2&Subscription-Key=${ctx.env.EDINET_API_KEY}`);
    if (!res.ok) throw new Error(`EDINET ${date}: HTTP ${res.status}`);
    const body = (await res.json()) as { results?: EdinetDay; metadata?: { message?: string } };
    if (!body.results) throw new Error(`EDINET ${date}: ${body.metadata?.message ?? "no results"}`);
    return body.results;
  });

/** The windows this ticker's earlier runs already read through (kept in its last EDINET answer). */
async function searchedBefore(ctx: SourceContext, symbol: string): Promise<string[]> {
  if (!ctx.db) return [];
  const [last] = await ctx.db
    .select({ payload: fetches.payload })
    .from(fetches)
    .where(and(eq(fetches.dimension, "filings"), eq(fetches.source, "edinet"), eq(fetches.subject, symbol), isNull(fetches.error)))
    .orderBy(desc(fetches.fetchedAt))
    .limit(1);
  return (last?.payload as { searched?: string[] } | undefined)?.searched ?? [];
}

/**
 * EDINET (Japan FSA): statutory reports (annual, half-year, quarterly, large holdings). Free key. The last 14 days, plus
 * the history: the window after each TDnet 決算短信 of the last 5 years, read through once (`edinetHistoryWindows`).
 * Before (2026-11-18) only the 14 days were read, so Miraial had one EDINET filing and no report text at all.
 */
export const edinet: FilingSource = {
  name: "edinet",
  registryName: "EDINET (Japan FSA)",
  requiredEnv: ["EDINET_API_KEY"],
  covers: isMarket("JP"),
  async fetch(symbol, ctx) {
    const secCode = `${tickerBase(symbol)}0`;
    const found = new Map<string, Record<string, string>>();
    const keep = (day: EdinetDay) => day.filter((d) => d.secCode === secCode).forEach((d) => found.set(d.docID, d));
    const dates = Array.from({ length: EDINET_DAYS }, (_, i) => isoDate(daysAgo(i)));
    for (const date of dates) keep(await edinetDay(ctx, date));

    // History: the windows not read through yet, newest first, within the run's budget of day lists.
    const searched = new Set(await searchedBefore(ctx, symbol));
    const since = new Date(Date.now() - EDINET_HISTORY_YEARS * 365.25 * 86_400_000);
    const summaries = ctx.db
      ? await ctx.db
          .select({ filingKey: filings.filingKey, title: filings.title, filedAt: filings.filedAt })
          .from(filings)
          .where(and(eq(filings.symbol, symbol), eq(filings.registry, "tdnet"), gte(filings.filedAt, since)))
      : [];
    const budget = await memo(ctx, "edinet:history-budget", async () => ({ left: EDINET_HISTORY_DAYS_PER_RUN, read: new Set<string>() }));
    let scanned = 0;
    let stoppedOn: string | null = null;
    windows: for (const w of edinetHistoryWindows(summaries)) {
      if (searched.has(w.anchor)) continue;
      let report = false;
      for (const date of w.dates) {
        if (!budget.read.has(date)) {
          if (budget.left <= 0) break windows;
          budget.left--;
          budget.read.add(date);
        }
        let day: EdinetDay;
        try {
          day = await edinetDay(ctx, date);
        } catch (e) {
          stoppedOn = (e as Error).message;
          break windows;
        }
        keep(day);
        scanned++;
        report = day.some((d) => d.secCode === secCode && EDINET_PERIODIC.has(d.docTypeCode) && d.withdrawalStatus === "0");
        if (report) break;
      }
      if (report || w.complete) searched.add(w.anchor);
    }
    return {
      request: {
        url: "https://api.edinet-fsa.go.jp/api/v2/documents.json",
        dates: [dates.at(-1), dates[0]],
        secCode,
        kept: "documents of this company only",
        history: { summaries: summaries.length, windowsRead: searched.size, daysScanned: scanned, ...(stoppedOn ? { stoppedOn } : {}) },
      },
      httpStatus: 200,
      payload: { secCode, documents: [...found.values()], searched: [...searched] },
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

/** OpenDART disclosure list (Korea FSS): 5 years of filings, 100 a page. Free key. */
export const dart: FilingSource = {
  name: "dart",
  registryName: "DART (Korea FSS)",
  requiredEnv: ["DART_API_KEY"],
  covers: (symbol) => isMarket("KR")(symbol) && dartCorpCode(symbol) !== null,
  async fetch(symbol, ctx) {
    const q = `corp_code=${dartCorpCode(symbol)}&bgn_de=${compact(historyStart())}&end_de=${compact(new Date())}&page_count=100`;
    const list: unknown[] = [];
    let first: FetchOutcome | null = null;
    let pages = 0;
    for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
      const out = await getJson(ctx, `https://opendart.fss.or.kr/api/list.json?${q}&page_no=${page}&crtfc_key=${ctx.env.DART_API_KEY}`, {
        url: `https://opendart.fss.or.kr/api/list.json?${q}&page_no=${page}`,
      });
      const p = out.payload as { status?: string; list?: unknown[]; total_page?: number } | undefined;
      // 013 = "no data": a valid answer, the company filed nothing in the window.
      const bad = out.error ?? (p?.status === "000" || p?.status === "013" ? null : `DART status ${p?.status}`);
      if (bad) return withError(out, bad);
      first ??= out;
      list.push(...(p?.list ?? []));
      pages = page;
      if (page >= (p?.total_page ?? 1)) break;
    }
    return { ...first!, request: { url: `https://opendart.fss.or.kr/api/list.json?${q}`, pages }, payload: { status: "000", list } };
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
    const base = `https://api.company-information.service.gov.uk/company/${companiesHouseNumber(symbol)}/filing-history?items_per_page=100`;
    const since = isoDate(historyStart());
    const items: { date: string }[] = [];
    let first: FetchOutcome | null = null;
    let pages = 0;
    // Newest first, 100 a page: read until a page reaches past 5 years or the history ends.
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const out = await getJson(ctx, `${base}&start_index=${page * 100}`, { url: `${base}&start_index=${page * 100}` }, { headers: { Authorization: `Basic ${btoa(`${ctx.env.COMPANIES_HOUSE_API_KEY}:`)}` } });
      if (out.error) return out;
      first ??= out;
      const got = ((out.payload as { items?: { date: string }[] }).items ?? []);
      items.push(...got);
      pages = page + 1;
      if (got.length < 100 || got.some((f) => f.date < since)) break;
    }
    return { ...first!, request: { url: base, pages }, payload: { items: items.filter((f) => f.date >= since) } };
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
    const from = compact(historyStart());
    const to = isoDate(new Date()).replace(/-/g, "");
    const url = `https://www1.hkexnews.hk/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK&stockId=${stockId}&documentType=-1&fromDate=${from}&toDate=${to}&title=&searchType=0&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=3000&lang=E`;
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

