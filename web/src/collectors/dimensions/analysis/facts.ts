import { eq } from "drizzle-orm";
import { quoteStamp } from "../intraday-price";
import { consensus } from "@/db/schema/consensus";
import { fairValues } from "@/db/schema/analysis";
import { revenueStreams, valuations, type GoldRevenueStream } from "@/db/schema/financials";
import { valuationReports } from "@/db/schema/valuation";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { itemsOf } from "../evidence/items";
import { seriesCatalog, seriesMenu, type StoredSeries } from "./series";

/**
 * Everything one analysis reads about a ticker, as plain text for the model, all from gold.
 * The quote enters the hash only as a 15% bucket: a daily price tick never re-asks, a real move does.
 */
export type AnalysisFacts = { symbol: string; text: string; hash: string; catalog: Map<string, StoredSeries>; quote: { close: number; date: string; currency: string | null } | null; currency: string | null; hasFinancials: boolean };

/** 291764969976 -> "291.8B"; 0.234 -> "23.4%". */
export function fmt(v: number | null | undefined, unit: string = "currency"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (unit === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (unit === "multiple") return `${v.toFixed(1)}x`;
  if (unit === "per-share") return v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/** FNV-1a, two seeds, 16 hex chars: pure (the console bundle lists dimensions). */
export function fnv(text: string): string {
  const one = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return one(2166136261) + one(0x9747b28c);
}

const TABLE_LINES = ["line:revenue", "line:gross-profit", "line:operating-income", "line:depreciation-amortization", "metric:ebitda", "line:net-income", "line:eps-diluted", "line:eps-basic", "metric:operating-margin", "metric:ebitda-margin", "metric:revenue-growth", "line:cfo", "line:capex", "metric:fcf", "line:dividends-paid", "line:buybacks", "line:cash", "line:total-debt", "metric:net-debt", "line:equity", "line:shares-outstanding", "metric:ev-ebitda", "metric:pe"];
const QUARTER_LINES = ["qline:revenue", "qline:operating-income", "qline:net-income", "qmetric:operating-margin"];
/**
 * What the company reports about its business beside the statements, when it does (a table drops absent rows): the
 * order book and new orders, each against revenue. Whether one matters, and whether the price saw it, is the model's call.
 */
const OPERATING_KEYS = ["line:backlog", "metric:backlog-growth", "metric:backlog-to-revenue", "line:remaining-performance-obligations", "metric:remaining-performance-obligations-growth", "metric:remaining-performance-obligations-to-revenue", "line:order-intake", "metric:book-to-bill"];
const OPERATING_QUARTER_KEYS = OPERATING_KEYS.map((k) => `q${k}`);
const HALF_LINES = ["hline:revenue", "hline:gross-profit", "hline:operating-income", "hline:net-income"];

const pct = (v: number | null) => (v === null ? null : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const periodName = (r: Pick<GoldRevenueStream, "periodType" | "periodEnd">) => (r.periodType === "year" ? `FY ${r.periodEnd}` : `${r.periodType === "half" ? "6 months" : "3 months"} to ${r.periodEnd}`);

/**
 * Every revenue stream the filings report (gold.revenue_streams), the total first: the last 3 fiscal years and the
 * interim periods after them, each with its growth on the same period a year earlier, its share of total revenue,
 * and the last 12 months at an interim end. Facts only: what they mean is the model's call.
 */
export function streamsText(rows: GoldRevenueStream[]): string | null {
  if (rows.length === 0) return null;
  const byLine = new Map<string, GoldRevenueStream[]>();
  for (const r of rows) byLine.set(r.line, [...(byLine.get(r.line) ?? []), r]);
  const latestYear = (rs: GoldRevenueStream[]) => rs.filter((r) => r.periodType === "year").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const lines = [...byLine.entries()].sort(([a, ra], [b, rb]) => (a === "revenue" ? -1 : b === "revenue" ? 1 : ra[0].axis.localeCompare(rb[0].axis) || (latestYear(rb)?.value ?? 0) - (latestYear(ra)?.value ?? 0)));
  const out = ["Revenue by stream (each period against the same period a year earlier; share = of total revenue that period; LTM = last 12 months):"];
  for (const [, rs] of lines) {
    const years = rs.filter((r) => r.periodType === "year").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-3);
    const lastYear = years.at(-1)?.periodEnd ?? "";
    const interim = rs.filter((r) => r.periodType !== "year" && r.periodEnd > minusYear(lastYear)).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.periodType.localeCompare(b.periodType));
    const cells = [...years, ...interim].map((r) => {
      const notes = [pct(r.growth), r.shareOfTotal !== null ? `${(r.shareOfTotal * 100).toFixed(0)}% of total` : null].filter(Boolean).join(", ");
      const ltm = r.ltmValue !== null ? `; LTM ${fmt(r.ltmValue)}${r.ltmGrowth !== null ? ` (${pct(r.ltmGrowth)} on the LTM a year earlier)` : ""} = ${r.ltmFormula}` : "";
      return `${periodName(r)} ${fmt(r.value)}${notes ? ` (${notes})` : ""}${ltm}`;
    });
    out.push(`- ${rs[0].axis === "total" ? rs[0].name : `${rs[0].axis}: ${rs[0].name}`}: ${cells.join(" | ")}`);
  }
  // How much of the total each axis covers in its latest period: streams that do not add up are said so.
  const axes = [...new Set(rows.filter((r) => r.axis !== "total").map((r) => r.axis))];
  const coverage = axes.map((axis) => {
    const r = rows.filter((x) => x.axis === axis && x.axisCoverage !== null).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    return r ? `${axis} streams add up to ${(r.axisCoverage! * 100).toFixed(0)}% of total revenue (${periodName(r)})` : null;
  });
  if (coverage.some(Boolean)) out.push(`Coverage: ${coverage.filter(Boolean).join("; ")}.`);
  return out.join("\n");
}
/**
 * The reported numbers every judge of the story reads (evidence, driver and thesis state): the last fiscal years,
 * quarters and half years, and revenue by stream. A results filing arrives as a title; these are its figures.
 */
export async function figuresText(db: Db, symbol: string): Promise<string> {
  const catalog = await seriesCatalog(db, symbol);
  const streams = await db.select().from(revenueStreams).where(eq(revenueStreams.symbol, symbol));
  const keys = (prefix: string) => ["revenue", "operating-income", "net-income"].map((l) => `${prefix}:${l}`).filter((k) => catalog.has(k));
  return [
    "The company's reported figures:",
    keys("line").length ? `Fiscal years:\n${table(catalog, keys("line"), 4)}` : "Fiscal years: none collected.",
    keys("qline").length ? `Last quarters:\n${table(catalog, keys("qline"), 4)}` : null,
    keys("hline").length ? `Last half years:\n${table(catalog, keys("hline"), 4)}` : null,
    operatingText(catalog),
    streamsText(streams),
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** The order book and new orders the company reports, fiscal years then quarters; null when it reports none. */
function operatingText(catalog: Map<string, StoredSeries>): string | null {
  const years = OPERATING_KEYS.filter((k) => catalog.has(k));
  const quarters = OPERATING_QUARTER_KEYS.filter((k) => catalog.has(k));
  if (years.length + quarters.length === 0) return null;
  return [
    "Operating figures the company reports (backlog = at the period end; x = times the revenue of the 12 months to that date):",
    years.length ? table(catalog, years, 4) : null,
    quarters.length ? `Quarters:\n${table(catalog, quarters, 4)}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

const minusYear = (ym: string) => (ym ? `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}` : "");

function table(catalog: Map<string, StoredSeries>, keys: string[], last: number): string {
  const rows = keys.map((k) => catalog.get(k)).filter((s): s is StoredSeries => !!s);
  if (rows.length === 0) return "none";
  const periods = [...new Set(rows.flatMap((s) => [...s.points.keys()]))].sort().slice(-last);
  return [`period | ${periods.join(" | ")}`, ...rows.map((s) => `${s.label} [${s.key}] | ${periods.map((p) => fmt(s.points.get(p), s.unit)).join(" | ")}`)].join("\n");
}

export async function gatherFacts(db: Db, symbol: string): Promise<AnalysisFacts> {
  const [ticker] = await db.select().from(gold.tickers).where(eq(gold.tickers.symbol, symbol));
  const [profile] = await db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
  const [quote] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol));
  const [valuation] = await db.select().from(valuations).where(eq(valuations.symbol, symbol));
  const cons = await db.select().from(consensus).where(eq(consensus.symbol, symbol));
  const [fairValue] = await db.select().from(fairValues).where(eq(fairValues.symbol, symbol));
  const [vreport] = await db.select({ summary: valuationReports.summary }).from(valuationReports).where(eq(valuationReports.symbol, symbol));
  const catalog = await seriesCatalog(db, symbol);
  const currency = valuation?.currency ?? profile?.currency ?? null;
  const streams = await db.select().from(revenueStreams).where(eq(revenueStreams.symbol, symbol));
  const halves = HALF_LINES.filter((k) => catalog.has(k));
  const price = catalog.get("price");
  const closes = price ? [...price.points].sort((a, b) => a[0].localeCompare(b[0])).slice(-24) : [];
  const items = (await itemsOf(db, symbol)).slice(0, 40);
  const upcoming = cons.filter((c) => c.mean !== null && c.periodType === "year").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  const stable = [
    `Company: ${profile?.name ?? symbol} (${symbol}), market ${ticker?.market ?? "?"}, ${[profile?.sector, profile?.industry].filter(Boolean).join(" / ") || "sector unknown"}.`,
    profile?.description ? `Description: ${profile.description.slice(0, 600)}` : null,
    `Analyst position: ${ticker?.position ?? "watch"}${ticker?.inPortfolio ? ", in his portfolio" : ""}.`,
    ticker?.thesisNote ? `Analyst's note: ${ticker.thesisNote}` : null,
    "",
    `Reported financials, fiscal years (${currency ?? "currency unknown"}; B = billion, M = million):`,
    table(catalog, TABLE_LINES, 6),
    "",
    "Last quarters:",
    table(catalog, QUARTER_LINES, 6),
    halves.length ? `\nLast half years:\n${table(catalog, halves, 4)}` : null,
    operatingText(catalog) ? `\n${operatingText(catalog)}` : null,
    streams.length ? `\n${streamsText(streams)}` : null,
    "",
    valuation
      ? `Valuation from gold: EV/EBITDA over fiscal years ${valuation.evEbitdaYears.join(", ") || "none"}: low ${fmt(valuation.evEbitdaLow, "multiple")}, median ${fmt(valuation.evEbitdaMedian, "multiple")}, high ${fmt(valuation.evEbitdaHigh, "multiple")}. Latest shares outstanding ${fmt(valuation.sharesOutstanding)}; net debt ${fmt(valuation.netDebt)} (${valuation.inputs["total-debt"]?.period ?? "n/a"}); EBITDA ${fmt(valuation.ebitda)} (${valuation.ebitdaBasis ?? "n/a"}).`
      : "Valuation: no financial statements collected.",
    upcoming.length ? `Analyst consensus (fiscal years): ${upcoming.map((c) => `${c.metric} ${c.periodEnd}: mean ${fmt(c.mean, c.metric === "eps" ? "per-share" : "currency")}, ${c.analysts ?? "?"} analysts${c.actual !== null ? `, reported ${fmt(c.actual, c.metric === "eps" ? "per-share" : "currency")}` : ""}`).join("; ")}.` : "Analyst consensus: none published for free.",
    "",
    closes.length ? `Price path, month-end closes (${price!.currency ?? ""}): ${closes.map(([m, v]) => `${m} ${fmt(v, "per-share")}`).join("; ")}` : "Price path: none collected.",
    "Analyst consensus history: only the current consensus is collected (no revisions).",
    "",
    "Stored chart series (key | label | span), the ONLY data an exhibit can show:",
    seriesMenu(catalog) || "none",
  ]
    .filter((x) => x !== null)
    .join("\n");
  // The news are context, never a reason to rewrite the story (Kevin 2026-11-09: 19 narratives in 3 days on NVRI, one
  // per news): they stay out of the hash; each one is judged against the narrative by `evidence` instead.
  const news = ["News and filings of the last 12 months (newest first):", items.length ? items.map((i) => `- ${i.at.toISOString().slice(0, 10)} ${i.kind}${i.publisher ? ` (${i.publisher})` : ""}: ${i.title}`).join("\n") : "none"].join("\n");

  const q = quote ? { close: quote.close, date: quote.date, currency: quote.currency, stamp: quoteStamp(quote) } : null;
  const fvLine = fairValue
    ? `Fair value (${fairValue.author === "thierry" ? "the analyst's own number" : "weighted from several valuation methods"}): ${fmt(fairValue.value, "per-share")} ${fairValue.currency ?? ""}${fairValue.low !== null && fairValue.high !== null ? `, range ${fmt(fairValue.low, "per-share")} to ${fmt(fairValue.high, "per-share")}` : ""}; ${fairValue.method ?? ""}.${vreport ? ` ${vreport.summary}` : ""}`
    : "Fair value: none yet (no valuation ran).";
  const fvBucket = fairValue && fairValue.value > 0 ? Math.round(Math.log(fairValue.value) / Math.log(1.15)) : "none";
  const priceLine = q ? `Quote: ${fmt(q.close, "per-share")} ${q.currency ?? ""} (${q.stamp}); market cap at that price ${valuation?.marketCap ? fmt(valuation.marketCap) : "n/a"}, EV/EBITDA now ${fmt(valuation?.evEbitda, "multiple")}.` : "Quote: none.";
  const bucket = q && q.close > 0 ? Math.round(Math.log(q.close) / Math.log(1.15)) : "none";
  return {
    symbol,
    text: `${priceLine}\n${fvLine}\n${stable}\n\n${news}`,
    hash: fnv(`${stable}\nprice-bucket:${bucket}\nfair-value-bucket:${fvBucket}`),
    catalog,
    quote: q,
    currency,
    // Annual revenue, reported or derived from what the company reported (gross profit + cost of revenue, 4 quarters).
    hasFinancials: catalog.has("line:revenue") || catalog.has("metric:revenue"),
  };
}
