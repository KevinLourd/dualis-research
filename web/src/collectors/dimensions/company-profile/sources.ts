import type { Source } from "../../types";
import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, companiesHouseNumber, dartCorpCode, isMarket, isTmxSymbol, marketOf, suffixOf, tickerBase } from "../../markets";
import type { ProfileField } from "./gold";

/** A profile source = how to fetch one ticker + how to read profile fields out of its raw answer. */
export type ProfileSource = Source & {
  /** Reads profile fields out of one raw answer about `subject`. */
  extract: (payload: unknown, subject: string) => Partial<Record<ProfileField, unknown>>;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** FMP stable profile. Free tier: US listings only. */
export const fmp: ProfileSource = {
  name: "fmp",
  requiredEnv: ["FMP_API_KEY"],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const q = `symbol=${encodeURIComponent(symbol)}`;
    const out = await getJson(
      ctx,
      `https://financialmodelingprep.com/stable/profile?${q}&apikey=${ctx.env.FMP_API_KEY}`,
      { url: `https://financialmodelingprep.com/stable/profile?${q}` },
    );
    if (!out.error && (!Array.isArray(out.payload) || out.payload.length === 0)) {
      return { ...out, error: "FMP returned no profile for this symbol" };
    }
    return out;
  },
  extract(payload) {
    const p = (payload as Record<string, unknown>[])[0];
    return {
      name: p.companyName,
      exchange: p.exchange,
      currency: p.currency,
      country: p.country,
      sector: p.sector,
      industry: p.industry,
      description: p.description,
      website: p.website,
      logoUrl: p.image,
      ipoDate: p.ipoDate,
      marketCap: num(p.marketCap),
      employees: num(p.fullTimeEmployees),
    };
  },
};

/** Finnhub profile2. Free tier: US listings only. Market cap comes in millions. */
export const finnhub: ProfileSource = {
  name: "finnhub",
  requiredEnv: ["FINNHUB_API_KEY"],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const q = `symbol=${encodeURIComponent(symbol)}`;
    const out = await getJson(ctx, `https://finnhub.io/api/v1/stock/profile2?${q}&token=${ctx.env.FINNHUB_API_KEY}`, {
      url: `https://finnhub.io/api/v1/stock/profile2?${q}`,
    });
    if (!out.error && Object.keys((out.payload as object) ?? {}).length === 0) {
      return { ...out, error: "Finnhub returned an empty profile for this symbol" };
    }
    return out;
  },
  extract(payload) {
    const p = payload as Record<string, unknown>;
    const cap = num(p.marketCapitalization);
    return {
      name: p.name,
      exchange: p.exchange,
      currency: p.currency,
      country: p.country,
      industry: p.finnhubIndustry,
      website: p.weburl,
      logoUrl: p.logo,
      ipoDate: p.ipo,
      marketCap: cap === null ? null : cap * 1_000_000,
    };
  },
};

/** Yahoo chart metadata: no key, every market. Gives the name, exchange and currency outside the US. */
export const yahoo: ProfileSource = {
  name: "yahoo",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const out = await getJson(ctx, url, { url }, { headers: { "User-Agent": "Mozilla/5.0 (dualis-collector)" } });
    const meta = (out.payload as { chart?: { result?: { meta?: unknown }[] } })?.chart?.result?.[0]?.meta;
    if (!out.error && !meta) return { ...out, error: "Yahoo returned no chart metadata for this symbol" };
    return out;
  },
  extract(payload) {
    const m = (payload as { chart: { result: { meta: Record<string, unknown> }[] } }).chart.result[0].meta;
    return { name: m.longName ?? m.shortName, exchange: m.fullExchangeName, currency: m.currency };
  },
};


/** Parses "364,332,161", "$12.06", "1.2K" style numbers; null when there is no number. */
export const parseNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};
/** A website as a URL, from "www.kdgas.co.kr" or "http://x.com/". */
const asUrl = (v: unknown) => (typeof v === "string" && v.trim() ? (/^https?:\/\//.test(v) ? v.trim() : `https://${v.trim()}`) : null);
/** Registers shout ("ASHTEAD TECHNOLOGY HOLDINGS PLC"): a name in capitals only reads as "Ashtead Technology Holdings Plc". */
export const softenCaps = (v: unknown) =>
  typeof v === "string" && v === v.toUpperCase() && /[A-Z]{3}/.test(v) ? v.toLowerCase().replace(/(^|[\s(&.,/-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase()) : v;
const capitalize = (v: unknown) => (typeof v === "string" && v ? v[0].toUpperCase() + v.slice(1) : v);
/** Employees: 0 means "not reported" in TMX and Wikidata answers. */
const headcount = (v: unknown) => {
  const n = parseNumber(v);
  return n && n > 0 ? n : null;
};

/** Nasdaq quote summary: sector, industry, exchange and market cap for US listings. No key. */
export const nasdaq: ProfileSource = {
  name: "nasdaq",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`;
    const out = await getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
    const data = (out.payload as { data?: { summaryData?: unknown } })?.data?.summaryData;
    if (!out.error && !data) return { ...out, error: "Nasdaq has no quote summary for this symbol" };
    return out;
  },
  extract(payload) {
    const d = (payload as { data: { summaryData: Record<string, { value: string }> } }).data.summaryData;
    return {
      exchange: d.Exchange?.value,
      sector: d.Sector?.value,
      industry: d.Industry?.value,
      marketCap: parseNumber(d.MarketCap?.value),
    };
  },
};

const TMX_QUERY =
  "query getQuoteBySymbol($symbol: String, $locale: String) { getQuoteBySymbol(symbol: $symbol, locale: $locale) { symbol name exchangeName sector industry employees website shortDescription MarketCap } }";

/** TMX Money (the TSX's own site API): Toronto and TSX Venture listings. No key. */
export const tmx: ProfileSource = {
  name: "tmx",
  requiredEnv: [],
  covers: isTmxSymbol,
  async fetch(symbol, ctx) {
    const url = "https://app-money.tmx.com/graphql";
    const variables = { symbol: tickerBase(symbol), locale: "en" };
    const out = await getJson(
      ctx,
      url,
      { url, query: "getQuoteBySymbol", variables },
      {
        method: "POST",
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json", Origin: "https://money.tmx.com", Referer: "https://money.tmx.com/" },
        body: JSON.stringify({ operationName: "getQuoteBySymbol", variables, query: TMX_QUERY }),
      },
    );
    if (!out.error && !(out.payload as { data?: { getQuoteBySymbol?: unknown } })?.data?.getQuoteBySymbol) {
      return { ...out, error: "TMX has no quote for this symbol" };
    }
    return out;
  },
  extract(payload) {
    const q = (payload as { data: { getQuoteBySymbol: Record<string, unknown> } }).data.getQuoteBySymbol;
    const description = typeof q.shortDescription === "string" && q.shortDescription.length > 60 ? q.shortDescription : null;
    return {
      name: q.name,
      exchange: q.exchangeName,
      country: "Canada",
      sector: q.sector,
      industry: q.industry,
      employees: headcount(q.employees),
      website: asUrl(q.website),
      description,
      marketCap: parseNumber(q.MarketCap),
    };
  },
};

/** ASX company header + about pages (the exchange's own research API). No key. */
export const asx: ProfileSource = {
  name: "asx",
  requiredEnv: [],
  covers: isMarket("AU"),
  async fetch(symbol, ctx) {
    const base = `https://asx.api.markitdigital.com/asx-research/1.0/companies/${encodeURIComponent(tickerBase(symbol))}`;
    const header = await getJson(ctx, `${base}/header`, { url: `${base}/header` }, { headers: BROWSER_HEADERS });
    if (header.error) return header;
    const about = await getJson(ctx, `${base}/about`, { url: `${base}/about` }, { headers: BROWSER_HEADERS });
    return { ...about, request: { urls: [`${base}/header`, `${base}/about`] }, payload: { header: header.payload, about: about.payload } };
  },
  extract(payload) {
    const p = payload as { header: { data: Record<string, unknown> }; about: { data: Record<string, unknown> } };
    const h = p.header.data;
    const a = p.about?.data ?? {};
    return {
      name: softenCaps(h.displayName),
      exchange: "ASX",
      currency: "AUD",
      country: "Australia",
      sector: h.sector,
      industry: h.industryGroup,
      marketCap: parseNumber(h.marketCap),
      ipoDate: h.dateListed,
      description: a.description,
      website: asUrl(a.websiteUrl),
    };
  },
};

/** OpenDART company overview: English name and website for Korean listings. Free key. */
export const dart: ProfileSource = {
  name: "dart",
  requiredEnv: ["DART_API_KEY"],
  covers: (symbol) => marketOf(symbol) === "KR" && dartCorpCode(symbol) !== null,
  async fetch(symbol, ctx) {
    const q = `corp_code=${dartCorpCode(symbol)}`;
    const out = await getJson(ctx, `https://opendart.fss.or.kr/api/company.json?${q}&crtfc_key=${ctx.env.DART_API_KEY}`, {
      url: `https://opendart.fss.or.kr/api/company.json?${q}`,
    });
    const status = (out.payload as { status?: string })?.status;
    if (!out.error && status !== "000") return { ...out, error: `DART status ${status}: ${(out.payload as { message?: string }).message}` };
    return out;
  },
  extract(payload) {
    const p = payload as Record<string, string>;
    return { name: softenCaps(p.corp_name_eng), website: asUrl(p.hm_url), country: "South Korea", currency: "KRW" };
  },
};

/** Companies House register: legal name and incorporation for UK listings. Free key. */
export const companiesHouse: ProfileSource = {
  name: "companies-house",
  requiredEnv: ["COMPANIES_HOUSE_API_KEY"],
  covers: (symbol) => companiesHouseNumber(symbol) !== null,
  async fetch(symbol, ctx) {
    const url = `https://api.company-information.service.gov.uk/company/${companiesHouseNumber(symbol)}`;
    return getJson(ctx, url, { url }, { headers: { Authorization: `Basic ${btoa(`${ctx.env.COMPANIES_HOUSE_API_KEY}:`)}` } });
  },
  extract(payload) {
    const p = payload as { company_name: string };
    return { name: softenCaps(p.company_name), country: "United Kingdom" };
  },
};

/** Which exchange labels on Wikidata belong to each market (a ticker code alone is ambiguous across exchanges). */
const WIKIDATA_EXCHANGE: Record<string, RegExp> = {
  US: /nasdaq|new york stock exchange|nyse|otc/i,
  CA: /toronto|tsx|canadian securities/i,
  JP: /tokyo|japan exchange/i,
  KR: /korea|kosdaq/i,
  UK: /london/i,
  HK: /hong kong/i,
  AU: /australian securities/i,
  PA: /paris|euronext/i,
  DE: /frankfurt|xetra|deutsche b/i,
};
const exchangePattern = (symbol: string) => WIKIDATA_EXCHANGE[marketOf(symbol) === "EU" ? suffixOf(symbol) : marketOf(symbol)];

/** Wikidata ticker codes drop leading zeros on some exchanges (HK "1161" for 01161). */
const wikidataCodes = (symbol: string) => {
  const base = tickerBase(symbol);
  return [...new Set([base, base.replace(/^0+(?=\d)/, "")])];
};

const WIKIDATA_QUERY = (codes: string[]) => `SELECT ?item ?itemLabel ?exLabel ?web ?logo ?emp ?countryLabel ?indLabel ?inception ?article WHERE {
  VALUES ?t { ${codes.map((c) => JSON.stringify(c)).join(" ")} }
  ?item p:P414 ?st . ?st pq:P249 ?t ; ps:P414 ?ex .
  OPTIONAL { ?item wdt:P856 ?web } OPTIONAL { ?item wdt:P154 ?logo } OPTIONAL { ?item wdt:P1128 ?emp }
  OPTIONAL { ?item wdt:P17 ?country } OPTIONAL { ?item wdt:P452 ?ind }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

type WikidataBinding = Record<string, { value: string } | undefined>;

/** Bindings of the Wikidata answer that sit on this symbol's exchange. */
export function wikidataMatches(symbol: string, payload: unknown): WikidataBinding[] {
  const rows = (payload as { results?: { bindings?: WikidataBinding[] } })?.results?.bindings ?? [];
  const pattern = exchangePattern(symbol);
  return rows.filter((b) => pattern?.test(b.exLabel?.value ?? ""));
}

async function wikidataLookup(symbol: string, ctx: Parameters<ProfileSource["fetch"]>[1]) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WIKIDATA_QUERY(wikidataCodes(symbol)))}`;
  return getJson(ctx, url, { url: "https://query.wikidata.org/sparql", codes: wikidataCodes(symbol) }, {
    headers: { "User-Agent": "DualisResearch/0.1 (research@dualisresearch.com)", Accept: "application/sparql-results+json" },
  });
}

/** Wikidata: logo, website, headcount, country and industry, every market. No key. */
export const wikidata: ProfileSource = {
  name: "wikidata",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const out = await wikidataLookup(symbol, ctx);
    if (!out.error && wikidataMatches(symbol, out.payload).length === 0) {
      return { ...out, error: "Wikidata has no company listed under this ticker on this exchange" };
    }
    return out;
  },
  extract(payload, symbol) {
    const b = wikidataMatches(symbol, payload)[0];
    const logo = b.logo?.value;
    return {
      name: b.itemLabel?.value && !/^Q\d+$/.test(b.itemLabel.value) ? b.itemLabel.value : null,
      website: b.web?.value,
      logoUrl: logo ? `${logo.replace(/^http:/, "https:")}?width=256` : null,
      employees: headcount(b.emp?.value),
      country: b.countryLabel?.value,
      industry: capitalize(b.indLabel?.value),
    };
  },
};

/** Wikipedia (English) summary of the company's article, found through Wikidata. No key. */
export const wikipedia: ProfileSource = {
  name: "wikipedia",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const lookup = await wikidataLookup(symbol, ctx);
    if (lookup.error) return lookup;
    const article = wikidataMatches(symbol, lookup.payload).find((b) => b.article)?.article?.value;
    if (!article) return { ...lookup, error: "No English Wikipedia article for this company" };
    const title = decodeURIComponent(article.split("/wiki/")[1]);
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    return getJson(ctx, url, { url }, { headers: { "User-Agent": "DualisResearch/0.1 (research@dualisresearch.com)" } });
  },
  extract(payload) {
    const p = payload as { extract?: string; title?: string };
    return { description: p.extract };
  },
};

/** FMP's public logo CDN (no key, every market): a 404 means FMP has no logo for the symbol. */
export const fmpLogo: ProfileSource = {
  name: "fmp-logo",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const url = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;
    const res = await ctx.fetch(url);
    const bytes = (await res.arrayBuffer()).byteLength;
    const contentType = res.headers.get("content-type");
    const payload = { url, contentType, bytes };
    if (!res.ok || !contentType?.startsWith("image/")) {
      return { request: { url }, httpStatus: res.status, payload, error: `no logo (HTTP ${res.status})` };
    }
    return { request: { url }, httpStatus: res.status, payload };
  },
  extract(payload) {
    return { logoUrl: (payload as { url: string }).url };
  },
};

export const PROFILE_SOURCES = [fmp, finnhub, nasdaq, tmx, asx, dart, companiesHouse, wikidata, wikipedia, fmpLogo, yahoo] as const;
