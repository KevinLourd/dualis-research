import { eq, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { goldOperatingKpis, operatingKpis, revenueStreams, type GoldOperatingKpi } from "@/db/schema/financials";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { deriveKpis, mergeKpiReadings } from "./derive";
import { filingDocuments, kpiReadings, KPI_SOURCE, type KpiPayload } from "./sources";

export const OPERATING_KPIS_DIMENSION = "operating-kpis";

export const operatingKpisDim: Dimension = {
  name: OPERATING_KPIS_DIMENSION,
  description:
    "Operating KPIs each company reports beyond its statements (backlog, order intake, bookings, subscribers, same-store sales, utilisation...), " +
    "read by Claude from its own filings and earnings releases; a value is kept only when its figure is printed in the passage it quotes. " +
    "Derived: growth on the same period a year earlier, ratio to revenue (a balance over the last 12 months of revenue).",
  sources: [filingDocuments],
  subjects: analysedSymbols,
  promote: promoteKpis,
};

/**
 * bronze -> silver.operating_kpis -> gold.operating_kpis. The latest answer per ticker carries every document read so
 * far (reused reads included), so it replaces that ticker's silver rows; a ticker whose fetch failed keeps its rows.
 */
export async function promoteKpis(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const latest = new Map<string, BronzeFetch>();
  for (const f of fetches.filter((x) => !x.error && x.source === KPI_SOURCE && x.payload).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f);
  const symbols = [...latest.keys()];
  if (symbols.length === 0) return { silverRowsBySource: {} };
  const silverRows = [...latest.values()].flatMap((f) => mergeKpiReadings(f.subject, kpiReadings(f.payload as KpiPayload), f.id));
  const streams = await db
    .select({ symbol: revenueStreams.symbol, line: revenueStreams.line, periodType: revenueStreams.periodType, periodEnd: revenueStreams.periodEnd, value: revenueStreams.value, currency: revenueStreams.currency, ltmValue: revenueStreams.ltmValue, ltmFormula: revenueStreams.ltmFormula })
    .from(revenueStreams)
    .where(inArray(revenueStreams.symbol, symbols));
  const goldRows = symbols.flatMap((s) =>
    deriveKpis(
      silverRows.filter((r) => r.symbol === s),
      streams.filter((x) => x.symbol === s),
    ),
  );
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(operatingKpis).where(inArray(operatingKpis.symbol, symbols));
    await tx.delete(goldOperatingKpis).where(inArray(goldOperatingKpis.symbol, symbols));
    for (let i = 0; i < silverRows.length; i += 500) await tx.insert(operatingKpis).values(silverRows.slice(i, i + 500).map((r) => ({ ...r, lastRebuiltAt: now })));
    for (let i = 0; i < goldRows.length; i += 500) await tx.insert(goldOperatingKpis).values(goldRows.slice(i, i + 500));
  });
  return { silverRowsBySource: { [KPI_SOURCE]: silverRows.length } };
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** 1234567 -> "1.2M"; a ratio as a percent; a multiple as "1.2x". */
function kpiValue(r: Pick<GoldOperatingKpi, "unit" | "value" | "currency" | "unitLabel">): string {
  if (r.unit === "ratio") return `${(r.value * 100).toFixed(1)}%`;
  if (r.unit === "multiple") return `${r.value.toFixed(2)}x`;
  const a = Math.abs(r.value);
  const n = a >= 1e9 ? `${(r.value / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(r.value / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(r.value / 1e3).toFixed(1)}K` : `${+r.value.toFixed(2)}`;
  return r.unit === "currency" ? `${n}${r.currency ? ` ${r.currency}` : ""}` : `${n}${r.unitLabel ? ` ${r.unitLabel}` : ""}`;
}

const PERIOD: Record<string, (pe: string) => string> = {
  instant: (pe) => `at ${pe}`,
  year: (pe) => `FY ${pe}`,
  half: (pe) => `6 months to ${pe}`,
  quarter: (pe) => `3 months to ${pe}`,
};

/** The stored chart series of a KPI (analysis/series.ts): a balance `kpi:`, a flow `ykpi:` / `hkpi:` / `qkpi:`. */
export const kpiSeriesKey = (kpi: string, periodType: string) => `${{ instant: "kpi", year: "ykpi", half: "hkpi", quarter: "qkpi" }[periodType] ?? "kpi"}:${kpi}`;

/** How many periods per KPI the judges read. */
const KPI_PERIODS = 6;

/**
 * The operating KPIs as the judges read them (analysis, evidence, driver and thesis state): each KPI's history, its
 * move on a year earlier, its ratio to revenue, and the passage the latest value was printed in. Facts only: whether a
 * KPI is a driver, and whether it is turning while the price has not moved, is the model's call.
 */
export function kpisText(rows: GoldOperatingKpi[]): string | null {
  if (rows.length === 0) return null;
  const byKpi = new Map<string, GoldOperatingKpi[]>();
  for (const r of rows) byKpi.set(`${r.kpi}|${r.periodType}`, [...(byKpi.get(`${r.kpi}|${r.periodType}`) ?? []), r]);
  const out = [
    "Operating KPIs the company reports (copied from its filings and earnings releases; growth = on the same period a year earlier; x revenue = the KPI over revenue: a balance at a date over the last 12 months of revenue to that date, a flow over revenue of the same period):",
  ];
  const groups = [...byKpi.values()].sort((a, b) => a[0].kpi.localeCompare(b[0].kpi) || a[0].periodType.localeCompare(b[0].periodType));
  for (const rs of groups) {
    const sorted = [...rs].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-KPI_PERIODS);
    const cells = sorted.map((r) => {
      const notes = [r.growth !== null ? pct(r.growth) : null, r.revenueRatio !== null ? `${r.revenueRatio.toFixed(2)}x ${r.revenueBasis}` : null].filter(Boolean).join(", ");
      return `${PERIOD[r.periodType](r.periodEnd)} ${kpiValue(r)}${notes ? ` (${notes})` : ""}`;
    });
    const last = sorted.at(-1)!;
    out.push(`- ${last.name} [${kpiSeriesKey(last.kpi, last.periodType)}]: ${cells.join(" | ")}`);
    out.push(`  Latest printed in ${last.citation.document} (filed ${last.citation.filedAt.slice(0, 10)}): "${last.citation.quote}"`);
  }
  return out.join("\n");
}

/** The KPI lines of one ticker for the judges (one small read: the gold rows of that ticker). */
export async function kpisTextOf(db: Db, symbol: string): Promise<string | null> {
  return kpisText(await db.select().from(goldOperatingKpis).where(eq(goldOperatingKpis.symbol, symbol)));
}
