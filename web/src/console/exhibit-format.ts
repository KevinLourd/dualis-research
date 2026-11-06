/** Exhibit labels and values, shared by server pages and the client chart (pure). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYear = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}-${d.slice(2, 4)}`;

export type ExhibitPeriod = "annual" | "quarterly" | "yearly" | "market";

/** Column label of a reported period: FY26 for a fiscal year ending in 2026, Sep-25 for a quarter. */
export function periodLabel(date: string, period: ExhibitPeriod): string {
  if (period === "annual") return `FY${date.slice(2, 4)}`;
  if (period === "yearly") return date.slice(0, 4);
  return monthYear(date);
}

export function formatExhibitValue(v: number, unit: string | null, compact = true): string {
  if (unit === "%") return `${v.toFixed(1)}%`;
  const n = new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(v);
  return unit ? `${n} ${unit}` : n;
}

export type ExhibitUnit = "currency" | "ratio" | "multiple" | "per-share" | "count";
/** A value in its series' unit: 25.0% for a ratio, 3.7x for a multiple, 1.2B KRW for an amount. */
export function formatUnit(v: number, unit: ExhibitUnit, currency: string | null): string {
  if (unit === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (unit === "multiple") return `${v.toFixed(1)}x`;
  if (unit === "per-share") return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
  const n = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return unit === "currency" && currency ? `${n} ${currency}` : n;
}
