import type { GoldFinancialLine, GoldFinancialMetric, GoldValuation } from "@/db/schema/financials";

/**
 * Derived metrics, computed deterministically from gold financial lines (no LLM, no estimate):
 * a metric exists only when every input line was published for that period.
 */
type Line = Pick<GoldFinancialLine, "periodType" | "periodEnd" | "line" | "value" | "currency" | "sources">;
type Metric = Omit<GoldFinancialMetric, "rebuiltAt">;
type Valuation = Omit<GoldValuation, "rebuiltAt">;

const MINOR_UNITS: Record<string, [string, number]> = { GBp: ["GBP", 0.01], GBX: ["GBP", 0.01], ZAc: ["ZAR", 0.01], ILA: ["ILS", 0.01] };
/** A quote in pence -> pounds. */
export function majorUnit(price: number, currency: string | null): { price: number; currency: string | null } {
  const m = currency ? MINOR_UNITS[currency] : undefined;
  return m ? { price: price * m[1], currency: m[0] } : { price, currency };
}

const minusYears = (ym: string, n: number) => `${Number(ym.slice(0, 4)) - n}${ym.slice(4)}`;
/** "2025-12" minus 3 months = "2025-09". */
export const minusMonths = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The reporting currency: the one most income lines carry. */
export function reportingCurrency(lines: Line[]): string | null {
  const counts = new Map<string, number>();
  for (const l of lines) if (l.currency && l.line !== "share-price") counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The enterprise value bridge (Wall Street Prep "What is Enterprise Value?", Corporate Finance Institute "Enterprise
 * Value"): EV = equity value + total debt + preferred stock + minority interest - cash - short-term investments -
 * equity-method investments. Read from ONE balance sheet date; debt and cash are required, a line the filings do not
 * report there counts zero and says so. Leases follow the source's own debt line (borrowings and bonds in the filings).
 * Equity value from an EV = the same bridge in reverse.
 */
export const BRIDGE_LINES = [
  { line: "total-debt", sign: 1, required: true },
  { line: "preferred-stock", sign: 1, required: false },
  { line: "minority-interest", sign: 1, required: false },
  { line: "cash", sign: -1, required: true },
  { line: "short-term-investments", sign: -1, required: false },
  { line: "equity-investments", sign: -1, required: false },
] as const;
export type BridgeLine = (typeof BRIDGE_LINES)[number]["line"];
export const BRIDGE_FORMULA = "total debt + preferred stock + minority interest - cash - short-term investments - equity-method investments";

export type BridgePart = { line: BridgeLine; sign: 1 | -1; value: number; reported: boolean; source: Line | null };

/** The bridge at one balance sheet date (same period type first, then the other one at that date); null without debt and cash. */
export function bridgeAt(lines: Line[], periodType: string, periodEnd: string): { total: number; parts: BridgePart[] } | null {
  const find = (line: string) =>
    lines.find((l) => l.line === line && l.periodEnd === periodEnd && l.periodType === periodType) ?? lines.find((l) => l.line === line && l.periodEnd === periodEnd && l.periodType !== "month");
  const parts: BridgePart[] = [];
  for (const b of BRIDGE_LINES) {
    const l = find(b.line);
    if (!l && b.required) return null;
    parts.push({ line: b.line, sign: b.sign, value: l?.value ?? 0, reported: !!l, source: l ?? null });
  }
  return { total: parts.reduce((s, p) => s + p.sign * p.value, 0), parts };
}

export function deriveMetrics(symbol: string, lines: Line[]): Metric[] {
  const currency = reportingCurrency(lines);
  const at = new Map(lines.map((l) => [`${l.periodType}|${l.periodEnd}|${l.line}`, l]));
  const get = (pt: string, pe: string, line: string) => at.get(`${pt}|${pe}|${line}`);
  // Metrics per fiscal year and quarter; half years feed the revenue streams (`streams.ts`).
  const periods = [...new Set(lines.filter((l) => l.periodType === "year" || l.periodType === "quarter").map((l) => `${l.periodType}|${l.periodEnd}`))].map((k) => k.split("|") as ["year" | "quarter", string]);
  const out: Metric[] = [];
  const metrics = new Map<string, number>();

  for (const [pt, pe] of periods) {
    const add = (metric: string, unit: Metric["unit"], formula: string, inputs: (Line | undefined)[], compute: (v: number[]) => number | null) => {
      if (inputs.some((x) => !x)) return;
      const ls = inputs as Line[];
      const value = compute(ls.map((l) => l.value));
      if (value === null || !Number.isFinite(value)) return;
      metrics.set(`${pt}|${pe}|${metric}`, value);
      out.push({
        symbol,
        periodType: pt,
        periodEnd: pe,
        metric,
        value,
        unit,
        currency: unit === "currency" || unit === "per-share" ? currency : null,
        formula,
        inputs: ls.map((l) => ({ line: l.line, periodEnd: l.periodEnd, value: l.value })),
        sources: [...new Set(ls.flatMap((l) => l.sources))].sort(),
      });
    };
    const g = (line: string) => get(pt, pe, line);
    const prior = (line: string) => get(pt, minusYears(pe, 1), line);
    // Revenue a source left out (Yahoo serves DRX.TO's annual gross profit and cost of revenue, not its annual revenue):
    // derived from what the company reported, a metric with its formula and inputs, never a reported line.
    if (!g("revenue")) {
      add("revenue", "currency", "gross profit + cost of revenue", [g("gross-profit"), g("cost-of-revenue")], ([gp, cor]) => gp + cor);
      const quarters = [0, 3, 6, 9].map((n) => get("quarter", minusMonths(pe, n), "revenue"));
      if (pt === "year" && !metrics.has(`${pt}|${pe}|revenue`)) add("revenue", "currency", "sum of the 4 reported quarters of the fiscal year", quarters, (v) => v.reduce((a, b) => a + b, 0));
    }
    add("ebitda", "currency", "operating income + depreciation and amortization", [g("operating-income"), g("depreciation-amortization")], ([oi, da]) => oi + da);
    add("fcf", "currency", "cash from operations - capital expenditure", [g("cfo"), g("capex")], ([cfo, capex]) => cfo - capex);
    add("net-debt", "currency", "total debt - cash and equivalents", [g("total-debt"), g("cash")], ([d, c]) => d - c);
    const margin = (metric: string, line: string) => add(metric, "ratio", `${line} / revenue`, [g(line), g("revenue")], ([x, r]) => (r > 0 ? x / r : null));
    margin("gross-margin", "gross-profit");
    margin("operating-margin", "operating-income");
    margin("net-margin", "net-income");
    add("revenue-growth", "ratio", pt === "year" ? "revenue / prior fiscal year revenue - 1" : "revenue / same quarter prior year - 1", [g("revenue"), prior("revenue")], ([r, p]) => (p > 0 ? r / p - 1 : null));
    // The order book against revenue (Thierry 2026-11-12: « over a hundred percent… ideally 200% » of sales): a balance
    // at the period end over the revenue of the 12 months to it; order intake over the same period's revenue.
    const ltmRevenue = pt === "year" ? [g("revenue")] : [0, 3, 6, 9].map((n) => get("quarter", minusMonths(pe, n), "revenue"));
    const ltmWords = pt === "year" ? "fiscal year revenue" : "revenue of the last 4 reported quarters";
    for (const line of ["backlog", "remaining-performance-obligations"] as const) {
      add(`${line}-to-revenue`, "multiple", `${line.replace(/-/g, " ")} / ${ltmWords}`, [g(line), ...ltmRevenue], ([b, ...r]) => {
        const rev = r.reduce((a, x) => a + x, 0);
        return rev > 0 ? b / rev : null;
      });
      add(`${line}-growth`, "ratio", `${line.replace(/-/g, " ")} / the same date a year earlier - 1`, [g(line), prior(line)], ([b, p]) => (p > 0 ? b / p - 1 : null));
    }
    add("book-to-bill", "multiple", "order intake / revenue of the same period", [g("order-intake"), g("revenue")], ([o, r]) => (r > 0 ? o / r : null));
    add("operating-income-growth", "ratio", pt === "year" ? "operating income / prior fiscal year - 1" : "operating income / same quarter prior year - 1", [g("operating-income"), prior("operating-income")], ([r, p]) => (p > 0 ? r / p - 1 : null));
  }
  // Second pass: metrics on metrics (EBITDA margin, FCF margin) and market values at each period end.
  for (const [pt, pe] of periods) {
    const m = (metric: string) => metrics.get(`${pt}|${pe}|${metric}`);
    const rev = get(pt, pe, "revenue");
    const ebitda = m("ebitda");
    const fcf = m("fcf");
    const base = (metric: string, value: number, unit: Metric["unit"], formula: string, inputs: Line[]) =>
      out.push({ symbol, periodType: pt, periodEnd: pe, metric, value, unit, currency: unit === "currency" || unit === "per-share" ? currency : null, formula, inputs: inputs.map((l) => ({ line: l.line, periodEnd: l.periodEnd, value: l.value })), sources: [...new Set(inputs.flatMap((l) => l.sources))].sort() });
    const ebitdaInputs = [get(pt, pe, "operating-income")!, get(pt, pe, "depreciation-amortization")!];
    if (ebitda !== undefined && rev && rev.value > 0) base("ebitda-margin", ebitda / rev.value, "ratio", "EBITDA / revenue", [...ebitdaInputs, rev]);
    if (fcf !== undefined && rev && rev.value > 0) base("fcf-margin", fcf / rev.value, "ratio", "free cash flow / revenue", [get(pt, pe, "cfo")!, get(pt, pe, "capex")!, rev]);

    const priceLine = get("month", pe, "share-price");
    const shares = get(pt, pe, "shares-outstanding") ?? get(pt, pe, "shares-diluted-avg");
    if (!priceLine || !shares) continue;
    const { price, currency: pc } = majorUnit(priceLine.value, priceLine.currency);
    if (!currency || pc !== currency) continue;
    const marketCap = price * shares.value;
    base("market-cap", marketCap, "currency", `month-end close x ${shares.line}`, [priceLine, shares]);
    const bridge = bridgeAt(lines, pt, pe);
    if (!bridge) continue;
    const ev = marketCap + bridge.total;
    const ndInputs = bridge.parts.flatMap((p) => (p.source ? [p.source] : []));
    base("ev", ev, "currency", `market cap + ${BRIDGE_FORMULA}`, [priceLine, shares, ...ndInputs]);
    if (pt === "year" && ebitda !== undefined && ebitda > 0) base("ev-ebitda", ev / ebitda, "multiple", "EV at fiscal year-end close / fiscal year EBITDA", [priceLine, shares, ...ndInputs, ...ebitdaInputs]);
    const eps = get(pt, pe, "eps-diluted") ?? get(pt, pe, "eps-basic");
    if (pt === "year" && eps && eps.value > 0) base("pe", price / eps.value, "multiple", `fiscal year-end close / ${eps.line}`, [priceLine, eps]);
  }
  return out;
}

type Quote = { date: string; close: number; currency: string | null } | null;

/** Today's EV/EBITDA and the 5-year range a fair value multiple is read against. */
export function deriveValuation(symbol: string, lines: Line[], metrics: Metric[], quote: Quote): Valuation {
  const currency = reportingCurrency(lines);
  const years = [...new Set(lines.filter((l) => l.periodType === "year" && l.line === "revenue").map((l) => l.periodEnd))].sort();
  const lastFiscalYear = years.at(-1) ?? null;
  const evEbitda = metrics.filter((m) => m.periodType === "year" && m.metric === "ev-ebitda").sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-5);
  const values = evEbitda.map((m) => m.value);
  const inputs: Valuation["inputs"] = {};

  const latest = (line: string) =>
    lines.filter((l) => l.line === line && l.periodType !== "month").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || (a.periodType === "quarter" ? -1 : 1))[0];
  const shares = latest("shares-outstanding");
  // Net debt from ONE balance sheet: the latest period carrying both debt and cash.
  const debtPeriods = lines.filter((l) => l.line === "total-debt" && l.periodType !== "month").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  let netDebt: number | null = null;
  let bridgeTotal: number | null = null;
  for (const d of debtPeriods) {
    const cash = lines.find((l) => l.line === "cash" && l.periodType === d.periodType && l.periodEnd === d.periodEnd);
    if (!cash) continue;
    netDebt = d.value - cash.value;
    const bridge = bridgeAt(lines, d.periodType, d.periodEnd)!;
    bridgeTotal = bridge.total;
    // Every bridge line, read on that same balance sheet: one the filings do not report there is zero, said so.
    for (const p of bridge.parts) {
      const at = p.source ?? d;
      inputs[p.line] = p.reported ? { value: p.value, period: `${at.periodType} ${at.periodEnd}`, sources: at.sources } : { value: 0, period: `${d.periodType} ${d.periodEnd}`, sources: [], reported: false };
    }
    break;
  }
  // EBITDA: the last 4 reported quarters when they run past the last fiscal year, else the last fiscal year.
  const q = metrics.filter((m) => m.periodType === "quarter" && m.metric === "ebitda").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, 4);
  const fy = metrics.find((m) => m.periodType === "year" && m.metric === "ebitda" && m.periodEnd === lastFiscalYear);
  let ebitda: number | null = null;
  let ebitdaBasis: string | null = null;
  const consecutive = q.length === 4 && q.every((m, i) => i === 0 || monthsBetween(m.periodEnd, q[i - 1].periodEnd) === 3);
  if (consecutive && (!lastFiscalYear || q[0].periodEnd > lastFiscalYear)) {
    ebitda = q.reduce((s, m) => s + m.value, 0);
    ebitdaBasis = `last 4 quarters to ${q[0].periodEnd}`;
    inputs.ebitda = { value: ebitda, period: ebitdaBasis, sources: [...new Set(q.flatMap((m) => m.sources))].sort() };
  } else if (fy) {
    ebitda = fy.value;
    ebitdaBasis = `fiscal year ${fy.periodEnd}`;
    inputs.ebitda = { value: ebitda, period: ebitdaBasis, sources: fy.sources };
  }
  if (shares) inputs["shares-outstanding"] = { value: shares.value, period: `${shares.periodType} ${shares.periodEnd}`, sources: shares.sources };

  const q2 = quote ? majorUnit(quote.close, quote.currency) : null;
  const sameCurrency = !!q2 && !!currency && (q2.currency === null || q2.currency === currency);
  const marketCap = sameCurrency && shares ? q2!.price * shares.value : null;
  if (marketCap !== null) inputs.quote = { value: q2!.price, period: quote!.date, sources: ["price"] };
  const ev = marketCap !== null && bridgeTotal !== null ? marketCap + bridgeTotal : null;
  return {
    symbol,
    currency,
    quoteCurrency: sameCurrency ? currency : null,
    lastFiscalYear,
    yearsCovered: years.length,
    evEbitdaLow: values.length ? Math.min(...values) : null,
    evEbitdaMedian: values.length ? median(values) : null,
    evEbitdaHigh: values.length ? Math.max(...values) : null,
    evEbitdaYears: evEbitda.map((m) => m.periodEnd),
    quoteDate: quote?.date ?? null,
    quote: q2?.price ?? null,
    sharesOutstanding: shares?.value ?? null,
    netDebt,
    ebitda,
    ebitdaBasis,
    marketCap,
    ev,
    evEbitda: ev !== null && ebitda !== null && ebitda > 0 ? ev / ebitda : null,
    inputs,
  };
}
