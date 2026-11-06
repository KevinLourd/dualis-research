/** Display helpers for the console. Pure, so pages and tests share them. */

export function compactMoney(value: number | null, currency: string | null): string | null {
  if (value === null) return null;
  const n = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return currency ? `${n} ${currency}` : n;
}

export function relativeTime(date: Date, now: Date = new Date()): string {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  const mo = Math.round(d / 30.4);
  return mo < 24 ? `${mo} months ago` : `${Math.round(mo / 12)} years ago`;
}

export function utc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const MARKET_LABEL: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  JP: "Japan",
  KR: "Korea",
  UK: "United Kingdom",
  HK: "Hong Kong",
  AU: "Australia",
  EU: "Europe",
};

/** "1,453" for 1453; up to 4 decimals under 1 (penny stocks), 2 otherwise. */
export function price(value: number | null, currency?: string | null): string | null {
  if (value === null) return null;
  const digits = Math.abs(value) < 1 ? 4 : Math.abs(value) >= 1000 ? 0 : 2;
  const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return currency ? `${n} ${currency}` : n;
}

/** "+2.4%" / "-0.8%" from a ratio. */
export function signedPct(ratio: number | null): string | null {
  if (ratio === null) return null;
  const pct = ratio * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(1)}%`;
}

/** "+11,149" / "-6,667". */
export function signedCount(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US")}`;
}

/** "4 Nov 2026" from "2026-11-04" or a Date. */
export function day(value: string | Date): string {
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
