import { desc, eq } from "drizzle-orm";
import { goldCatalysts } from "@/db/schema/catalysts";
import { consensus } from "@/db/schema/consensus";
import { valuations } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
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
  const [thesis] = await db.select().from(theses).where(eq(theses.symbol, symbol));
  const [valuation] = await db.select().from(valuations).where(eq(valuations.symbol, symbol));
  const cons = await db.select().from(consensus).where(eq(consensus.symbol, symbol));
  const cats = await db.select().from(goldCatalysts).where(eq(goldCatalysts.symbol, symbol)).orderBy(desc(goldCatalysts.eventAt)).limit(12);
  const catalog = await seriesCatalog(db, symbol);
  const currency = valuation?.currency ?? profile?.currency ?? null;
  const segments = [...catalog.values()].filter((s) => s.key.startsWith("line:segment:"));
  const price = catalog.get("price");
  const closes = price ? [...price.points].sort((a, b) => a[0].localeCompare(b[0])).slice(-24) : [];
  const items = (await itemsOf(db, symbol)).slice(0, 40);
  const upcoming = cons.filter((c) => c.mean !== null && c.periodType === "year").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  const stable = [
    `Company: ${profile?.name ?? symbol} (${symbol}), market ${ticker?.market ?? "?"}, ${[profile?.sector, profile?.industry].filter(Boolean).join(" / ") || "sector unknown"}.`,
    profile?.description ? `Description: ${profile.description.slice(0, 600)}` : null,
    `Analyst position: ${ticker?.position ?? "watch"}${ticker?.inPortfolio ? ", in his portfolio" : ""}.`,
    `Narrative on file (what the price tells): ${thesis?.narrative ?? "none"}`,
    `Analyst's view of it: ${thesis?.summary ?? "none"}`,
    ticker?.thesisNote ? `Analyst's note: ${ticker.thesisNote}` : null,
    thesis?.fairValue ? `Analyst's own fair value: ${thesis.fairValue} ${thesis.currency ?? ""} (${thesis.fairValueBasis ?? "no basis given"}).` : null,
    "",
    `Reported financials, fiscal years (${currency ?? "currency unknown"}; B = billion, M = million):`,
    table(catalog, TABLE_LINES, 6),
    "",
    "Last quarters:",
    table(catalog, QUARTER_LINES, 6),
    segments.length ? `\nSegment revenue:\n${table(catalog, segments.map((s) => s.key), 3)}` : null,
    "",
    valuation
      ? `Valuation from gold: EV/EBITDA over fiscal years ${valuation.evEbitdaYears.join(", ") || "none"}: low ${fmt(valuation.evEbitdaLow, "multiple")}, median ${fmt(valuation.evEbitdaMedian, "multiple")}, high ${fmt(valuation.evEbitdaHigh, "multiple")}. Latest shares outstanding ${fmt(valuation.sharesOutstanding)}; net debt ${fmt(valuation.netDebt)} (${valuation.inputs["total-debt"]?.period ?? "n/a"}); EBITDA ${fmt(valuation.ebitda)} (${valuation.ebitdaBasis ?? "n/a"}).`
      : "Valuation: no financial statements collected.",
    upcoming.length ? `Analyst consensus (fiscal years): ${upcoming.map((c) => `${c.metric} ${c.periodEnd}: mean ${fmt(c.mean, c.metric === "eps" ? "per-share" : "currency")}, ${c.analysts ?? "?"} analysts${c.actual !== null ? `, reported ${fmt(c.actual, c.metric === "eps" ? "per-share" : "currency")}` : ""}`).join("; ")}.` : "Analyst consensus: none published for free.",
    "",
    closes.length ? `Price path, month-end closes (${price!.currency ?? ""}): ${closes.map(([m, v]) => `${m} ${fmt(v, "per-share")}`).join("; ")}` : "Price path: none collected.",
    "Analyst consensus history: only the current consensus is collected (no revisions).",
    "",
    "News and filings of the last 12 months (newest first):",
    items.length ? items.map((i) => `- ${i.at.toISOString().slice(0, 10)} ${i.kind}${i.publisher ? ` (${i.publisher})` : ""}: ${i.title}`).join("\n") : "none",
    "",
    "Evidence judged so far (news and filings vs the narrative):",
    cats.length ? cats.map((c) => `- ${c.eventDay} ${c.kind}: "${c.headline}" ${c.direction} the narrative${c.reason ? `: ${c.reason}` : ""}`).join("\n") : "none",
    "",
    "Stored chart series (key | label | span), the ONLY data an exhibit can show:",
    seriesMenu(catalog) || "none",
  ]
    .filter((x) => x !== null)
    .join("\n");

  const q = quote ? { close: quote.close, date: quote.date, currency: quote.currency } : null;
  const priceLine = q ? `Quote: ${fmt(q.close, "per-share")} ${q.currency ?? ""} on ${q.date}; market cap at that price ${valuation?.marketCap ? fmt(valuation.marketCap) : "n/a"}, EV/EBITDA now ${fmt(valuation?.evEbitda, "multiple")}.` : "Quote: none.";
  const bucket = q && q.close > 0 ? Math.round(Math.log(q.close) / Math.log(1.15)) : "none";
  return {
    symbol,
    text: `${priceLine}\n${stable}`,
    hash: fnv(`${stable}\nprice-bucket:${bucket}`),
    catalog,
    quote: q,
    currency,
    hasFinancials: catalog.has("line:revenue"),
  };
}
