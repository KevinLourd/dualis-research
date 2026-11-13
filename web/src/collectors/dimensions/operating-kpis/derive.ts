import type { GoldOperatingKpi, GoldRevenueStream, KpiCitation, SilverOperatingKpi } from "@/db/schema/financials";
import { minusMonths } from "../financials/derive";
import type { KpiReading } from "./sources";

/**
 * Operating KPIs, computed deterministically (no LLM, no estimate, no rule per KPI or sector):
 * silver = one row per (ticker, KPI, period), every document that printed it, the latest filed one's value shown;
 * gold = + the move on the same period a year earlier + for a currency KPI its ratio to revenue.
 * What a KPI means for the story (a backlog at twice revenue the price ignores) is the analysis' call.
 */

export type SilverKpiRow = Omit<SilverOperatingKpi, "lastRebuiltAt">;
export type GoldKpiRow = Omit<GoldOperatingKpi, "rebuiltAt">;

const citationOf = (r: KpiReading): KpiCitation => ({ document: r.document.title, url: r.document.url, registry: r.document.registry, filedAt: r.document.filedAt, quote: r.quote, printed: r.printed });

/** Readings of one ticker -> silver rows. Several documents print the same period: one row, every document kept. */
export function mergeKpiReadings(symbol: string, readings: KpiReading[], bronzeId: string): SilverKpiRow[] {
  const groups = new Map<string, KpiReading[]>();
  for (const r of readings) {
    const k = `${r.kpi}|${r.periodType}|${r.periodEnd}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: SilverKpiRow[] = [];
  for (const rs of groups.values()) {
    // The latest filed document wins (a restatement); one observation per document.
    const byDoc = new Map<string, KpiReading>();
    for (const r of [...rs].sort((a, b) => b.document.filedAt.localeCompare(a.document.filedAt))) if (!byDoc.has(r.document.url)) byDoc.set(r.document.url, r);
    const docs = [...byDoc.values()];
    const lead = docs[0];
    out.push({
      symbol,
      kpi: lead.kpi,
      periodType: lead.periodType,
      periodEnd: lead.periodEnd,
      name: lead.name,
      unit: lead.unit,
      unitLabel: lead.unitLabel,
      currency: lead.currency,
      value: lead.value,
      sources: [...new Set(docs.map((d) => d.document.registry))].sort(),
      bronzeIds: [bronzeId],
      observations: docs.map((d) => ({ ...citationOf(d), value: d.value })),
    });
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b));

/**
 * The revenue a KPI compares to. A balance at a date (backlog at 2026-09) = the last 12 months of revenue to that
 * month: the fiscal year ending then, the LTM the filings give at an interim end, else 4 published quarters. A flow
 * (bookings in a quarter) = revenue of the same period. Null when not published for that period.
 */
export function revenueFor(streams: Pick<GoldRevenueStream, "line" | "periodType" | "periodEnd" | "value" | "currency" | "ltmValue" | "ltmFormula">[], periodType: string, periodEnd: string): { value: number; basis: string; currency: string | null } | null {
  const total = streams.filter((s) => s.line === "revenue");
  const at = (pt: string, pe: string) => total.find((s) => s.periodType === pt && s.periodEnd === pe);
  if (periodType !== "instant") {
    const r = at(periodType, periodEnd);
    return r ? { value: r.value, basis: periodType === "year" ? `FY ${periodEnd} revenue` : `${periodType === "half" ? "6 months" : "3 months"} to ${periodEnd} revenue`, currency: r.currency } : null;
  }
  const fy = at("year", periodEnd);
  if (fy) return { value: fy.value, basis: `FY ${periodEnd} revenue`, currency: fy.currency };
  const interim = total.find((s) => s.periodType !== "year" && s.periodEnd === periodEnd && s.ltmValue !== null);
  if (interim) return { value: interim.ltmValue!, basis: `LTM revenue to ${periodEnd} = ${interim.ltmFormula}`, currency: interim.currency };
  const quarters = [0, 3, 6, 9].map((m) => at("quarter", minusMonths(periodEnd, m)));
  if (quarters.every(Boolean)) return { value: quarters.reduce((s, q) => s + q!.value, 0), basis: `LTM revenue to ${periodEnd} = 4 quarters to ${periodEnd}`, currency: quarters[0]!.currency };
  return null;
}

export function deriveKpis(rows: SilverKpiRow[], streams: Parameters<typeof revenueFor>[0]): GoldKpiRow[] {
  const at = new Map(rows.map((r) => [`${r.symbol}|${r.kpi}|${r.periodType}|${r.periodEnd}`, r]));
  return rows.map((r) => {
    const prior = at.get(`${r.symbol}|${r.kpi}|${r.periodType}|${minusMonths(r.periodEnd, 12)}`);
    const priorValue = prior && prior.unit === r.unit ? prior.value : null;
    const rev = r.unit === "currency" ? revenueFor(streams, r.periodType, r.periodEnd) : null;
    // A ratio only between amounts in the same currency.
    const comparable = rev && rev.value > 0 && r.currency && rev.currency && r.currency.toUpperCase() === rev.currency.toUpperCase();
    const [lead, ...others] = r.observations;
    return {
      symbol: r.symbol,
      kpi: r.kpi,
      periodType: r.periodType,
      periodEnd: r.periodEnd,
      name: r.name,
      unit: r.unit,
      unitLabel: r.unitLabel,
      currency: r.currency,
      value: r.value,
      priorValue,
      growth: priorValue !== null && priorValue > 0 ? r.value / priorValue - 1 : null,
      revenue: comparable ? rev.value : null,
      revenueBasis: comparable ? rev.basis : null,
      revenueRatio: comparable ? r.value / rev.value : null,
      sources: r.sources,
      citation: { document: lead.document, url: lead.url, registry: lead.registry, filedAt: lead.filedAt, quote: lead.quote, printed: lead.printed },
      alternatives: others.filter((o) => !close(o.value, r.value)).map((o) => ({ document: o.document, value: o.value })),
    };
  });
}
