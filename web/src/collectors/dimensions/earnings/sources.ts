import type { FetchOutcome, Source, SourceContext } from "../../types";
import { getJson, isUsSymbol } from "../../http";
import { BROWSER_HEADERS, daysAgo, isoDate } from "../../markets";
import { parseNumber } from "../company-profile/sources";
import { usDate } from "../price/sources";

export const EARNINGS_FIELDS = ["reportDate", "hour", "epsActual", "epsEstimate", "revenueActual", "revenueEstimate"] as const;
export type EarningsField = (typeof EARNINGS_FIELDS)[number];

/** One fiscal quarter as a source reports it. `period` = quarter end month, "YYYY-MM". */
export type EarningsItem = { period: string; values: Partial<Record<EarningsField, unknown>> };

export type EarningsSource = Source & { extract: (payload: unknown) => EarningsItem[] };

/** "2026-09-30" -> "2026-09"; adds `quarters` quarters to a "YYYY-MM" period. */
const month = (d: string) => d.slice(0, 7);
export function addQuarters(period: string, quarters: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + quarters * 3;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

type FinnhubCalendar = { date: string; hour: string; year: number; quarter: number; epsEstimate: number | null; epsActual: number | null; revenueEstimate: number | null; revenueActual: number | null };
type FinnhubHistory = { period: string; year: number; quarter: number; estimate: number | null; actual: number | null };

/**
 * Finnhub earnings calendar (report dates, EPS and revenue, estimate vs actual, two years back and one ahead) +
 * EPS history (gives each fiscal quarter its period end). US listings, free key.
 */
export const finnhub: EarningsSource = {
  name: "finnhub",
  requiredEnv: ["FINNHUB_API_KEY"],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const out = await fetchFinnhubEarnings(symbol, ctx);
    if (!out.error && !(out.payload as FinnhubPayload).calendar.earningsCalendar?.length && !(out.payload as FinnhubPayload).history?.length) {
      return { ...out, error: "Finnhub has no earnings for this symbol" };
    }
    return out;
  },
  extract: extractFinnhubEarnings,
};

type FinnhubPayload = { calendar: { earningsCalendar?: FinnhubCalendar[] }; history: FinnhubHistory[] };

/** Finnhub calendar + EPS history in one bronze-ready outcome (shared with the consensus dimension). */
export async function fetchFinnhubEarnings(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
  const s = encodeURIComponent(symbol);
  const calQ = `symbol=${s}&from=${isoDate(daysAgo(730))}&to=${isoDate(daysAgo(-365))}`;
  const calendar = await getJson(ctx, `https://finnhub.io/api/v1/calendar/earnings?${calQ}&token=${ctx.env.FINNHUB_API_KEY}`, {
    url: `https://finnhub.io/api/v1/calendar/earnings?${calQ}`,
  });
  if (calendar.error) return calendar;
  const history = await getJson(ctx, `https://finnhub.io/api/v1/stock/earnings?symbol=${s}&token=${ctx.env.FINNHUB_API_KEY}`, {
    url: `https://finnhub.io/api/v1/stock/earnings?symbol=${s}`,
  });
  return {
    request: { urls: [calendar.request.url, history.request.url] },
    httpStatus: history.httpStatus,
    payload: { calendar: calendar.payload, history: history.payload ?? history.payloadText },
    ...(history.error ? { error: history.error } : {}),
  };
}

/** Finnhub answer -> one item per fiscal quarter (period end from the EPS history, the next report placed after it). */
export function extractFinnhubEarnings(payload: unknown): EarningsItem[] {
  const p = payload as FinnhubPayload;
  const history = p.history ?? [];
  const fiscal = (y: number, q: number) => y * 4 + q;
  // Anchor: a quarter whose period end we know, to place calendar quarters that have none yet (the next report).
  const anchor = [...history].sort((a, b) => fiscal(b.year, b.quarter) - fiscal(a.year, a.quarter))[0];
  const periodOf = (year: number, quarter: number) => {
    const known = history.find((h) => h.year === year && h.quarter === quarter);
    if (known) return month(known.period);
    return anchor ? addQuarters(month(anchor.period), fiscal(year, quarter) - fiscal(anchor.year, anchor.quarter)) : null;
  };
  const items: EarningsItem[] = history.map((h) => ({ period: month(h.period), values: { epsActual: h.actual, epsEstimate: h.estimate } }));
  for (const c of p.calendar.earningsCalendar ?? []) {
    const period = periodOf(c.year, c.quarter);
    if (!period) continue;
    items.push({
      period,
      values: {
        reportDate: c.date,
        hour: c.hour || null,
        epsActual: c.epsActual,
        epsEstimate: c.epsEstimate,
        revenueActual: c.revenueActual,
        revenueEstimate: c.revenueEstimate,
      },
    });
  }
  return items;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Nasdaq earnings surprise table (Zacks): report date, EPS actual vs consensus, last four quarters. US, no key. */
export const nasdaq: EarningsSource = {
  name: "nasdaq",
  requiredEnv: [],
  covers: isUsSymbol,
  async fetch(symbol, ctx) {
    const url = `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/earnings-surprise`;
    const out = await getJson(ctx, url, { url }, { headers: BROWSER_HEADERS });
    const rows = (out.payload as { data?: { earningsSurpriseTable?: { rows?: unknown[] } } })?.data?.earningsSurpriseTable?.rows;
    if (!out.error && !rows?.length) return { ...out, error: "Nasdaq has no earnings history for this symbol" };
    return out;
  },
  extract(payload) {
    const rows = (payload as { data: { earningsSurpriseTable: { rows: Record<string, string | number>[] } } }).data.earningsSurpriseTable.rows;
    return rows.map((r) => {
      const [mon, year] = String(r.fiscalQtrEnd).split(" ");
      return {
        period: `${year}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}`,
        values: { reportDate: usDate(String(r.dateReported)), epsActual: parseNumber(r.eps), epsEstimate: parseNumber(r.consensusForecast) },
      };
    });
  },
};

export const EARNINGS_SOURCES = [nasdaq, finnhub] as const;

export const EARNINGS_NOT_COVERED = "No free source publishes an earnings calendar for this market yet; results show up in the Filings tab as the company files them.";
