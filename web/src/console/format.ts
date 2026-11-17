/** Display helpers for the console. Pure, so pages and tests share them. */

/**
 * One Intl formatter per option set, built once per isolate. Building one costs ~0.1 ms of CPU and a page formats
 * hundreds of dates and numbers: on the Workers free plan (10 ms CPU a request) that alone ended renders
 * (2026-11-17: the fair-value panel answered 1102). Never call `new Intl.*` or `toLocale*String(locale, options)` in a
 * render path: use these.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat("en-US", options)));
  return f;
}
const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(locale: "en-GB" | "en-US", options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}

export function compactMoney(value: number | null, currency: string | null): string | null {
  if (value === null) return null;
  const n = numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(value);
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
  const n = numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
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
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${numberFormat().format(Math.abs(n))}`;
}

/** "4 Nov 2026" from "2026-11-04" or a Date. */
export function day(value: string | Date): string {
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return dateFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
