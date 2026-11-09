import { eq } from "drizzle-orm";
import { consensus } from "@/db/schema/consensus";
import { valuations } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { ValuationInput } from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import { seriesCatalog, type StoredSeries } from "../analysis/series";
import { majorUnit } from "../financials/derive";
import { FACT_LABEL, type FactKey, type HistoryKey, type ValuationFacts } from "./methods";

/** Peers and analyst targets come from their own dimensions (readers injected so this file stays pure of them). */
export type MarketReads = { peers: ValuationFacts["peers"]; targets: ValuationFacts["targets"] };

const sorted = (s: StoredSeries | undefined) => (s ? [...s.points].sort((a, b) => a[0].localeCompare(b[0])) : []);
const last = (s: StoredSeries | undefined) => sorted(s).at(-1) ?? null;

/** Everything the methods read about one ticker, from gold: figures with their period and sources, per-year histories. */
export async function valuationFacts(db: Db, symbol: string, market: MarketReads): Promise<ValuationFacts> {
  const [[valuation], [profile], cons, catalog] = await Promise.all([
    db.select().from(valuations).where(eq(valuations.symbol, symbol)),
    db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)),
    db.select().from(consensus).where(eq(consensus.symbol, symbol)),
    seriesCatalog(db, symbol),
  ]);
  const inputs: Partial<Record<FactKey, ValuationInput>> = {};
  const put = (key: FactKey, value: number | null | undefined, unit: ValuationInput["unit"], period: string, sources: string[]) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    inputs[key] = { key, label: FACT_LABEL[key], value, unit, period, sources };
  };
  const vi = valuation?.inputs ?? {};
  if (valuation?.sharesOutstanding) put("shares", valuation.sharesOutstanding, "count", vi["shares-outstanding"]?.period ?? "", vi["shares-outstanding"]?.sources ?? []);
  if (valuation?.netDebt !== null && valuation?.netDebt !== undefined) {
    put("net-debt", valuation.netDebt, "currency", vi["total-debt"]?.period ?? "", [...new Set([...(vi["total-debt"]?.sources ?? []), ...(vi.cash?.sources ?? [])])]);
    put("total-debt", vi["total-debt"]?.value, "currency", vi["total-debt"]?.period ?? "", vi["total-debt"]?.sources ?? []);
    put("cash", vi.cash?.value, "currency", vi.cash?.period ?? "", vi.cash?.sources ?? []);
  }
  if (valuation?.ebitda) put("ebitda", valuation.ebitda, "currency", valuation.ebitdaBasis ?? "", vi.ebitda?.sources ?? []);
  const eps = catalog.get("line:eps-diluted") ?? catalog.get("line:eps-basic");
  const lastEps = last(eps);
  if (lastEps) put("eps-trailing", lastEps[1], "per-share", `fiscal year ${lastEps[0]}`, eps!.sources);
  const fy = valuation?.lastFiscalYear ?? "";
  const next = cons.filter((c) => c.metric === "eps" && c.periodType === "year" && c.mean !== null && c.periodEnd > fy).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))[0];
  if (next) put("eps-forward", next.mean, "per-share", `fiscal year ${next.periodEnd}, ${next.analysts ?? "?"} analysts`, next.provenance.mean?.sources ?? []);
  const eq_ = catalog.get("line:equity");
  const lastEq = last(eq_);
  if (lastEq) put("equity", lastEq[1], "currency", `fiscal year ${lastEq[0]}`, eq_!.sources);
  const fcf = catalog.get("metric:fcf");
  const fcfs = sorted(fcf);
  if (fcfs.length) {
    put("fcf-last", fcfs.at(-1)![1], "currency", `fiscal year ${fcfs.at(-1)![0]}`, fcf!.sources);
    const three = fcfs.slice(-3);
    put("fcf-average", three.reduce((s, x) => s + x[1], 0) / three.length, "currency", `fiscal years ${three.map((x) => x[0]).join(", ")}`, fcf!.sources);
  }
  const div = catalog.get("line:dividends-paid");
  const lastDiv = last(div);
  if (lastDiv) put("dividends", Math.abs(lastDiv[1]), "currency", `fiscal year ${lastDiv[0]}`, div!.sources);

  // Histories, per fiscal year, from gold series.
  const history: ValuationFacts["history"] = {};
  const series = (k: string) => sorted(catalog.get(k)).map(([period, value]) => ({ period, value }));
  const ratio = (num: string, den: string, abs = false) => {
    const d = catalog.get(den);
    return sorted(catalog.get(num))
      .map(([period, value]) => ({ period, n: abs ? Math.abs(value) : value, d: d?.points.get(period) }))
      .filter((x) => x.d !== undefined && x.d > 0)
      .map((x) => ({ period: x.period, value: x.n / x.d! }));
  };
  const set = (k: HistoryKey, pts: { period: string; value: number }[]) => {
    if (pts.length) history[k] = pts.slice(-6);
  };
  set("ev-ebitda", series("metric:ev-ebitda"));
  set("pe", series("metric:pe"));
  set("pb", ratio("metric:market-cap", "line:equity"));
  set("fcf", series("metric:fcf"));
  set("dividend-yield", ratio("line:dividends-paid", "metric:market-cap", true));
  set("net-cash", series("metric:net-debt").map((x) => ({ period: x.period, value: -x.value })));

  // The company's own size, growth and margins, last fiscal year (a premium or discount to peers is set from them).
  const lastOf = (k: string) => last(catalog.get(k))?.[1] ?? null;
  const own = { marketCap: valuation?.marketCap ?? null, revenueGrowth: lastOf("metric:revenue-growth"), ebitdaMargin: lastOf("metric:ebitda-margin"), netMargin: lastOf("metric:net-margin") };

  const q = valuation?.quote !== null && valuation?.quote !== undefined && valuation.quoteCurrency ? { price: valuation.quote, date: valuation.quoteDate ?? "" } : null;
  return { symbol, name: profile?.name ?? null, currency: valuation?.currency ?? null, quote: q, inputs, history, own, peers: market.peers, targets: market.targets };
}

/** A target in a quote currency (pence, KRW...) brought to the reporting currency when it matches; else dropped. */
export function targetsIn(currency: string | null, t: { low: number; mean: number; high: number; analysts: number | null; currency: string | null; sources: string[] } | null): ValuationFacts["targets"] {
  if (!t) return null;
  const m = (x: number) => majorUnit(x, t.currency);
  const cur = m(t.mean).currency;
  if (currency && cur && cur !== currency) return null;
  return { low: m(t.low).price, mean: m(t.mean).price, high: m(t.high).price, analysts: t.analysts, currency: cur, sources: t.sources };
}
