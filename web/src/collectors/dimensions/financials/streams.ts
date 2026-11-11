import type { GoldFinancialLine, GoldRevenueStream } from "@/db/schema/financials";
import { minusMonths } from "./derive";

/**
 * Revenue per stream, computed deterministically from gold financial lines (no LLM, no estimate): the total
 * (`revenue`) and every segment line (`segment:<axis>:<name>`), per fiscal year, half year and quarter.
 * Each row: growth against the same period a year earlier, share of total revenue, how much of the total its axis
 * covers, and the last 12 months (LTM) at an interim period end, the standard way (Wall Street Prep, "Last Twelve
 * Months"): last fiscal year + the interim periods since - the same periods a year earlier.
 * Data only: the analysis reads the rows and decides what they mean.
 */
type Line = Pick<GoldFinancialLine, "periodType" | "periodEnd" | "line" | "value" | "currency" | "sources" | "citation">;
export type RevenueStreamRow = Omit<GoldRevenueStream, "rebuiltAt">;
type FlowPeriod = "year" | "half" | "quarter";

const LENGTH: Record<FlowPeriod, number> = { year: 12, half: 6, quarter: 3 };
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const isStream = (line: string) => line === "revenue" || line.startsWith("segment:");
const isFlow = (pt: string): pt is FlowPeriod => pt === "year" || pt === "half" || pt === "quarter";

/** "segment:product:Skincare" -> ["product", "Skincare"]; "revenue" -> ["total", "Total revenue"]. */
export function streamName(line: string): [string, string] {
  if (line === "revenue") return ["total", "Total revenue"];
  const [, axis, ...name] = line.split(":");
  return [axis, name.join(":")];
}

const periodLabel = (pt: FlowPeriod, pe: string) => (pt === "year" ? `FY ${pe}` : `${pt === "half" ? "6 months" : "3 months"} to ${pe}`);

export function deriveRevenueStreams(symbol: string, lines: Line[]): RevenueStreamRow[] {
  const flows = lines.filter((l) => isStream(l.line) && isFlow(l.periodType));
  const at = new Map(flows.map((l) => [`${l.periodType}|${l.periodEnd}|${l.line}`, l]));
  const get = (pt: string, pe: string, line: string) => at.get(`${pt}|${pe}|${line}`);

  /** LTM ending at an interim period end: null unless every input period was published. */
  const ltm = (line: string, pt: FlowPeriod, pe: string): { value: number; formula: string; inputs: Line[] } | null => {
    if (pt === "year") return null;
    const fy = flows
      .filter((l) => l.line === line && l.periodType === "year" && l.periodEnd < pe && monthsBetween(l.periodEnd, pe) < 12)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    if (!fy) return null;
    const gap = monthsBetween(fy.periodEnd, pe);
    if (gap % LENGTH[pt] !== 0) return null;
    const ends = Array.from({ length: gap / LENGTH[pt] }, (_, i) => minusMonths(pe, i * LENGTH[pt])).reverse();
    const current = ends.map((e) => get(pt, e, line));
    const prior = ends.map((e) => get(pt, minusMonths(e, 12), line));
    if (current.some((x) => !x) || prior.some((x) => !x)) return null;
    const cur = current as Line[];
    const pri = prior as Line[];
    const value = fy.value + cur.reduce((s, l) => s + l.value, 0) - pri.reduce((s, l) => s + l.value, 0);
    const formula = `${periodLabel("year", fy.periodEnd)} + ${cur.map((l) => periodLabel(pt, l.periodEnd)).join(" + ")} - ${pri.map((l) => periodLabel(pt, l.periodEnd)).join(" - ")}`;
    return { value, formula, inputs: [fy, ...cur, ...pri] };
  };

  const out: RevenueStreamRow[] = [];
  for (const l of flows) {
    const pt = l.periodType as FlowPeriod;
    const [axis, name] = streamName(l.line);
    const prior = get(pt, minusMonths(l.periodEnd, 12), l.line);
    const total = get(pt, l.periodEnd, "revenue");
    const axisSum = axis === "total" ? null : flows.filter((x) => x.periodType === pt && x.periodEnd === l.periodEnd && x.line.startsWith(`segment:${axis}:`)).reduce((s, x) => s + x.value, 0);
    const now = ltm(l.line, pt, l.periodEnd);
    const before = now ? ltm(l.line, pt, minusMonths(l.periodEnd, 12)) : null;
    out.push({
      symbol,
      line: l.line,
      axis,
      name,
      periodType: pt,
      periodEnd: l.periodEnd,
      value: l.value,
      currency: l.currency,
      priorValue: prior?.value ?? null,
      growth: prior && prior.value > 0 ? l.value / prior.value - 1 : null,
      shareOfTotal: axis !== "total" && total && total.value > 0 ? l.value / total.value : null,
      axisCoverage: axisSum !== null && total && total.value > 0 ? axisSum / total.value : null,
      ltmValue: now?.value ?? null,
      ltmPrior: before?.value ?? null,
      ltmGrowth: now && before && before.value > 0 ? now.value / before.value - 1 : null,
      ltmFormula: now?.formula ?? null,
      sources: [...new Set([...l.sources, ...(now?.inputs.flatMap((x) => x.sources) ?? [])])].sort(),
      citation: l.citation ?? null,
    });
  }
  return out.sort((a, b) => a.line.localeCompare(b.line) || a.periodType.localeCompare(b.periodType) || a.periodEnd.localeCompare(b.periodEnd));
}
