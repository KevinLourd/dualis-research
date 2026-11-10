import { eq } from "drizzle-orm";
import type { ExhibitPoint, ExhibitSeries } from "@/db/schema/analysis";
import { consensus } from "@/db/schema/consensus";
import { financialMetrics, goldFinancialLines } from "@/db/schema/financials";
import type { Db } from "@/db/types";
import { LINES, type LineKey } from "../financials/lines";

/**
 * The stored series a ticker's Exhibits can draw from: every number on a chart comes from here (gold), never from
 * the model. Keys:
 *   line:<line> / qline:<line>        reported line, fiscal years / quarters (gold.financial_lines)
 *   metric:<m> / qmetric:<m>          derived metric (gold.financial_metrics)
 *   consensus:<m> / actual:<m>        analyst mean vs reported actual per fiscal year (gold.consensus)
 *   qconsensus:<m> / qactual:<m>      same per quarter
 *   price                             month-end close, 5 years
 */
export type StoredSeries = ExhibitSeries & { periodType: "year" | "quarter" | "month"; points: Map<string, number> };

const titleCase = (s: string) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const METRIC_NAMES: Record<string, string> = {
  revenue: "Revenue (derived)",
  ebitda: "EBITDA",
  fcf: "Free cash flow",
  "net-debt": "Net debt",
  "gross-margin": "Gross margin",
  "operating-margin": "Operating margin",
  "net-margin": "Net margin",
  "ebitda-margin": "EBITDA margin",
  "fcf-margin": "FCF margin",
  "revenue-growth": "Revenue growth",
  "operating-income-growth": "Operating income growth",
  "market-cap": "Market cap",
  ev: "Enterprise value",
  "ev-ebitda": "EV/EBITDA",
  pe: "P/E",
};

export async function seriesCatalog(db: Db, symbol: string): Promise<Map<string, StoredSeries>> {
  const out = new Map<string, StoredSeries>();
  const put = (key: string, base: Omit<StoredSeries, "key" | "points" | "sources">, period: string, value: number, sources: string[]) => {
    const s = out.get(key) ?? { key, ...base, sources: [], points: new Map<string, number>() };
    s.points.set(period, value);
    s.sources = [...new Set([...s.sources, ...sources])].sort();
    out.set(key, s);
  };
  for (const l of await db.select().from(goldFinancialLines).where(eq(goldFinancialLines.symbol, symbol))) {
    if (l.line === "share-price") {
      put("price", { label: "Share price (month-end close)", unit: "per-share", currency: l.currency, periodType: "month" }, l.periodEnd, l.value, l.sources);
      continue;
    }
    if (l.periodType === "month") continue;
    const name = l.line.startsWith("segment:") ? `Segment revenue: ${l.line.split(":").slice(2).join(":")}` : (LINES[l.line as LineKey]?.name ?? titleCase(l.line));
    const unit = /^eps-/.test(l.line) ? "per-share" : /^shares-/.test(l.line) ? "count" : "currency";
    put(`${l.periodType === "year" ? "line" : "qline"}:${l.line}`, { label: l.periodType === "year" ? name : `${name} (quarterly)`, unit, currency: unit === "count" ? null : l.currency, periodType: l.periodType }, l.periodEnd, l.value, l.sources);
  }
  for (const m of await db.select().from(financialMetrics).where(eq(financialMetrics.symbol, symbol))) {
    const name = METRIC_NAMES[m.metric] ?? titleCase(m.metric);
    put(`${m.periodType === "year" ? "metric" : "qmetric"}:${m.metric}`, { label: m.periodType === "year" ? name : `${name} (quarterly)`, unit: m.unit, currency: m.currency, periodType: m.periodType }, m.periodEnd, m.value, m.sources);
  }
  for (const c of await db.select().from(consensus).where(eq(consensus.symbol, symbol))) {
    const q = c.periodType === "quarter";
    const name = titleCase(c.metric);
    const unit = c.metric === "eps" ? "per-share" : "currency";
    const srcOf = (stat: string) => c.provenance[stat]?.sources ?? [];
    if (c.mean !== null) put(`${q ? "qconsensus" : "consensus"}:${c.metric}`, { label: `${name}, analyst mean${q ? " (quarterly)" : ""}`, unit, currency: c.currency, periodType: c.periodType }, c.periodEnd, c.mean, srcOf("mean"));
    if (c.actual !== null) put(`${q ? "qactual" : "actual"}:${c.metric}`, { label: `${name}, reported${q ? " (quarterly)" : ""}`, unit, currency: c.currency, periodType: c.periodType }, c.periodEnd, c.actual, srcOf("actual"));
  }
  return out;
}

/** How many periods an exhibit shows per period type. */
const WINDOW = { year: 6, quarter: 8, month: 60 } as const;

/** The data of one exhibit: the union of its series' periods (latest window), one value per series, null when unpublished. */
export function exhibitData(catalog: Map<string, StoredSeries>, keys: string[]): { series: ExhibitSeries[]; points: ExhibitPoint[]; sources: string[] } | null {
  const series = keys.map((k) => catalog.get(k)).filter((s): s is StoredSeries => !!s && s.points.size >= 2);
  if (series.length === 0) return null;
  const type = series[0].periodType;
  const same = series.filter((s) => s.periodType === type);
  const periods = [...new Set(same.flatMap((s) => [...s.points.keys()]))].sort().slice(-WINDOW[type]);
  return {
    series: same.map(({ key, label, unit, currency, sources }) => ({ key, label, unit, currency, sources })),
    points: periods.map((period) => ({ period, values: Object.fromEntries(same.map((s) => [s.key, s.points.get(period) ?? null])) })),
    sources: [...new Set(same.flatMap((s) => s.sources))].sort(),
  };
}

/** The menu the model picks exhibits from: key, label, how many periods, the span. */
export function seriesMenu(catalog: Map<string, StoredSeries>): string {
  return [...catalog.values()]
    .filter((s) => s.points.size >= 2)
    .map((s) => {
      const periods = [...s.points.keys()].sort();
      return `${s.key} | ${s.label} | ${s.points.size} ${s.periodType}s ${periods[0]}..${periods.at(-1)}`;
    })
    .join("\n");
}
