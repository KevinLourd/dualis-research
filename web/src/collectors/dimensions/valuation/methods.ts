import type { Scenario, ValuationHistory, ValuationInput, ValuationMethodId, ValuationStep } from "@/db/schema/valuation";

/**
 * The fixed catalogue of Valuation Methods (Kevin 2026-11-06). Claude never computes a value: it picks each method's
 * assumptions per scenario (low / base / high) with a why; the arithmetic below turns them into a value per share from
 * the reported figures. Pure: the console lists the catalogue.
 */

/** What every method can read: reported figures as gold holds them (full units, reporting currency). */
export type ValuationFacts = {
  symbol: string;
  name: string | null;
  currency: string | null;
  /** Today's price in the reporting currency, or null when the quote is in another currency. */
  quote: { price: number; date: string } | null;
  /** Each figure with its period and sources; absent = not collected. */
  inputs: Partial<Record<FactKey, ValuationInput>>;
  /** Per-year history of each multiple / figure, oldest first. */
  history: Partial<Record<HistoryKey, { period: string; value: number }[]>>;
  /** Comparable companies' multiples today (peers method). */
  peers: { symbol: string; name: string | null; currency: string | null; evEbitda: number | null; pe: number | null; sources: string[] }[];
  /** Analyst price targets (analyst-targets method). */
  targets: { low: number; mean: number; high: number; analysts: number | null; currency: string | null; sources: string[] } | null;
};

export type FactKey = "shares" | "net-debt" | "cash" | "total-debt" | "ebitda" | "eps-trailing" | "eps-forward" | "equity" | "fcf-last" | "fcf-average" | "dividends";
export type HistoryKey = "ev-ebitda" | "pe" | "pb" | "fcf" | "dividend-yield" | "net-cash";

export type AssumptionSpec = { key: string; label: string; unit: "multiple" | "ratio" };
type Values = Record<string, number>;
type Computed = { value: number; steps: { label: string; unit: ValuationInput["unit"]; value: number }[] };

export type MethodSpec = {
  id: ValuationMethodId;
  name: string;
  family: "Multiples" | "Intrinsic" | "Assets" | "Income" | "Market";
  description: string;
  /** Assumptions Claude sets per scenario; none = the method reads its values (analyst targets). */
  assumptions: AssumptionSpec[];
  /** Bases the method can be run on, Claude picks one (first = default). */
  bases?: { id: string; label: string }[];
  /** The history it reads against (chart in the method's panel). */
  history?: { key: HistoryKey; label: string; unit: ValuationInput["unit"] };
  /** Null when it can run, else why not (missing or negative inputs). */
  notApplicable: (f: ValuationFacts) => string | null;
  /** The inputs it uses. */
  uses: (f: ValuationFacts, basis: string | null) => FactKey[];
  compute: (f: ValuationFacts, a: Values, basis: string | null) => Computed;
};

const v = (f: ValuationFacts, k: FactKey) => f.inputs[k]?.value ?? null;
const need = (f: ValuationFacts, keys: FactKey[], positive: FactKey[] = []): string | null => {
  const missing = keys.filter((k) => v(f, k) === null);
  if (missing.length) return `Not collected: ${missing.map((k) => FACT_LABEL[k]).join(", ")}.`;
  const negative = positive.filter((k) => !(v(f, k)! > 0));
  return negative.length ? `${negative.map((k) => FACT_LABEL[k]).join(", ")} is zero or negative.` : null;
};

export const FACT_LABEL: Record<FactKey, string> = {
  shares: "Shares outstanding",
  "net-debt": "Net debt",
  cash: "Cash",
  "total-debt": "Total debt",
  ebitda: "EBITDA",
  "eps-trailing": "EPS, last fiscal year",
  "eps-forward": "EPS, next fiscal year consensus",
  equity: "Shareholders' equity",
  "fcf-last": "Free cash flow, last fiscal year",
  "fcf-average": "Free cash flow, 3-year average",
  dividends: "Dividends paid, last fiscal year",
};

const perShare = (f: ValuationFacts, equityValue: number, steps: Computed["steps"]): Computed => {
  const shares = v(f, "shares")!;
  return { value: equityValue / shares, steps: [...steps, { label: "Shares outstanding", unit: "count", value: shares }, { label: "Value per share", unit: "per-share", value: equityValue / shares }] };
};

export const DCF_YEARS = 5;

export const VALUATION_METHODS: readonly MethodSpec[] = [
  {
    id: "ev-ebitda",
    name: "EV/EBITDA, own history",
    family: "Multiples",
    description: "A multiple of EBITDA read against the company's own 5-year range, minus net debt, per share.",
    assumptions: [{ key: "multiple", label: "EV/EBITDA multiple", unit: "multiple" }],
    history: { key: "ev-ebitda", label: "EV/EBITDA at each fiscal year end", unit: "multiple" },
    notApplicable: (f) => need(f, ["ebitda", "net-debt", "shares"], ["ebitda", "shares"]),
    uses: () => ["ebitda", "net-debt", "shares"],
    compute: (f, a) => {
      const ev = a.multiple * v(f, "ebitda")!;
      return perShare(f, ev - v(f, "net-debt")!, [
        { label: "EBITDA", unit: "currency", value: v(f, "ebitda")! },
        { label: "x multiple", unit: "multiple", value: a.multiple },
        { label: "Enterprise value", unit: "currency", value: ev },
        { label: "- net debt", unit: "currency", value: v(f, "net-debt")! },
        { label: "Equity value", unit: "currency", value: ev - v(f, "net-debt")! },
      ]);
    },
  },
  {
    id: "pe",
    name: "P/E",
    family: "Multiples",
    description: "A multiple of earnings per share, on last year's reported EPS or next year's consensus EPS.",
    assumptions: [{ key: "multiple", label: "P/E multiple", unit: "multiple" }],
    bases: [
      { id: "trailing", label: "Last fiscal year EPS" },
      { id: "forward", label: "Next fiscal year consensus EPS" },
    ],
    history: { key: "pe", label: "P/E at each fiscal year end", unit: "multiple" },
    notApplicable: (f) => (v(f, "eps-trailing")! > 0 || v(f, "eps-forward")! > 0 ? null : "Earnings per share are negative or not collected."),
    uses: (_f, basis) => [basis === "forward" ? "eps-forward" : "eps-trailing"],
    compute: (f, a, basis) => {
      const eps = v(f, basis === "forward" ? "eps-forward" : "eps-trailing")!;
      return { value: a.multiple * eps, steps: [{ label: basis === "forward" ? "EPS, next year consensus" : "EPS, last fiscal year", unit: "per-share", value: eps }, { label: "x multiple", unit: "multiple", value: a.multiple }, { label: "Value per share", unit: "per-share", value: a.multiple * eps }] };
    },
  },
  {
    id: "pb",
    name: "P/B, book value",
    family: "Assets",
    description: "A multiple of shareholders' equity per share, read against the company's own price-to-book history.",
    assumptions: [{ key: "multiple", label: "P/B multiple", unit: "multiple" }],
    history: { key: "pb", label: "Price to book at each fiscal year end", unit: "multiple" },
    notApplicable: (f) => need(f, ["equity", "shares"], ["equity", "shares"]),
    uses: () => ["equity", "shares"],
    compute: (f, a) => {
      const bvps = v(f, "equity")! / v(f, "shares")!;
      return { value: a.multiple * bvps, steps: [{ label: "Shareholders' equity", unit: "currency", value: v(f, "equity")! }, { label: "Book value per share", unit: "per-share", value: bvps }, { label: "x multiple", unit: "multiple", value: a.multiple }, { label: "Value per share", unit: "per-share", value: a.multiple * bvps }] };
    },
  },
  {
    id: "dcf",
    name: "DCF on free cash flow",
    family: "Intrinsic",
    description: `Reported free cash flow grown for ${DCF_YEARS} years, a terminal value, both discounted, minus net debt, per share.`,
    assumptions: [
      { key: "growth", label: `FCF growth, years 1-${DCF_YEARS}`, unit: "ratio" },
      { key: "terminalGrowth", label: "Terminal growth", unit: "ratio" },
      { key: "discountRate", label: "Discount rate", unit: "ratio" },
    ],
    bases: [
      { id: "average", label: "3-year average free cash flow" },
      { id: "last", label: "Last fiscal year free cash flow" },
    ],
    history: { key: "fcf", label: "Free cash flow per fiscal year", unit: "currency" },
    notApplicable: (f) => {
      const miss = need(f, ["net-debt", "shares"], ["shares"]);
      if (miss) return miss;
      return v(f, "fcf-average")! > 0 || v(f, "fcf-last")! > 0 ? null : "Free cash flow is negative or not collected.";
    },
    uses: (_f, basis) => [basis === "last" ? "fcf-last" : "fcf-average", "net-debt", "shares"],
    compute: (f, a, basis) => {
      const fcf0 = v(f, basis === "last" ? "fcf-last" : "fcf-average")!;
      if (!(a.discountRate > a.terminalGrowth + 0.01)) throw new Error(`dcf: discount rate ${a.discountRate} must exceed terminal growth ${a.terminalGrowth} by 1 point`);
      let pv = 0;
      let fcf = fcf0;
      for (let t = 1; t <= DCF_YEARS; t++) {
        fcf *= 1 + a.growth;
        pv += fcf / (1 + a.discountRate) ** t;
      }
      const terminal = (fcf * (1 + a.terminalGrowth)) / (a.discountRate - a.terminalGrowth);
      const pvTerminal = terminal / (1 + a.discountRate) ** DCF_YEARS;
      const ev = pv + pvTerminal;
      return perShare(f, ev - v(f, "net-debt")!, [
        { label: basis === "last" ? "FCF, last fiscal year" : "FCF, 3-year average", unit: "currency", value: fcf0 },
        { label: `FCF in year ${DCF_YEARS}`, unit: "currency", value: fcf },
        { label: `Present value of years 1-${DCF_YEARS}`, unit: "currency", value: pv },
        { label: "Terminal value", unit: "currency", value: terminal },
        { label: "Present value of terminal", unit: "currency", value: pvTerminal },
        { label: "Enterprise value", unit: "currency", value: ev },
        { label: "- net debt", unit: "currency", value: v(f, "net-debt")! },
        { label: "Equity value", unit: "currency", value: ev - v(f, "net-debt")! },
      ]);
    },
  },
  {
    id: "net-assets",
    name: "Net cash and assets",
    family: "Assets",
    description: "Deep-value floor: net cash, plus the rest of the book value at a recovery rate.",
    assumptions: [{ key: "recovery", label: "Recovery on non-cash net assets", unit: "ratio" }],
    history: { key: "net-cash", label: "Net cash at each fiscal year end", unit: "currency" },
    notApplicable: (f) => need(f, ["equity", "net-debt", "shares"], ["shares"]),
    uses: () => ["equity", "net-debt", "shares"],
    compute: (f, a) => {
      const netCash = -v(f, "net-debt")!;
      const other = v(f, "equity")! - netCash;
      const equity = netCash + a.recovery * other;
      return perShare(f, equity, [
        { label: "Net cash", unit: "currency", value: netCash },
        { label: "Other net assets (equity - net cash)", unit: "currency", value: other },
        { label: "x recovery", unit: "ratio", value: a.recovery },
        { label: "Equity value", unit: "currency", value: equity },
      ]);
    },
  },
  {
    id: "dividend-yield",
    name: "Dividend yield",
    family: "Income",
    description: "Last year's dividend per share divided by the yield the stock should trade at, read against its own yield history.",
    assumptions: [{ key: "yield", label: "Dividend yield", unit: "ratio" }],
    history: { key: "dividend-yield", label: "Dividend yield at each fiscal year end", unit: "ratio" },
    notApplicable: (f) => need(f, ["dividends", "shares"], ["dividends", "shares"]) && "No dividend paid last fiscal year.",
    uses: () => ["dividends", "shares"],
    compute: (f, a) => {
      if (!(a.yield > 0)) throw new Error("dividend-yield: the yield must be positive");
      const dps = v(f, "dividends")! / v(f, "shares")!;
      return { value: dps / a.yield, steps: [{ label: "Dividends paid", unit: "currency", value: v(f, "dividends")! }, { label: "Dividend per share", unit: "per-share", value: dps }, { label: "/ yield", unit: "ratio", value: a.yield }, { label: "Value per share", unit: "per-share", value: dps / a.yield }] };
    },
  },
  {
    id: "peers",
    name: "Listed peers",
    family: "Market",
    description: "The multiple comparable listed companies trade at today, applied to this company's EBITDA or earnings.",
    assumptions: [{ key: "multiple", label: "Peer multiple", unit: "multiple" }],
    bases: [
      { id: "ev-ebitda", label: "Peers' EV/EBITDA on this EBITDA" },
      { id: "pe", label: "Peers' P/E on this EPS" },
    ],
    notApplicable: (f) => (f.peers.some((p) => p.evEbitda !== null || p.pe !== null) ? null : "No comparable company's multiples collected yet."),
    uses: (_f, basis) => (basis === "pe" ? ["eps-trailing"] : ["ebitda", "net-debt", "shares"]),
    compute: (f, a, basis) => {
      if (basis === "pe") {
        const eps = v(f, "eps-trailing");
        if (!(eps! > 0)) throw new Error("peers: P/E basis needs a positive EPS");
        return { value: a.multiple * eps!, steps: [{ label: "EPS, last fiscal year", unit: "per-share", value: eps! }, { label: "x peer P/E", unit: "multiple", value: a.multiple }, { label: "Value per share", unit: "per-share", value: a.multiple * eps! }] };
      }
      if (!(v(f, "ebitda")! > 0) || v(f, "net-debt") === null || !(v(f, "shares")! > 0)) throw new Error("peers: EV/EBITDA basis needs EBITDA, net debt and shares");
      const ev = a.multiple * v(f, "ebitda")!;
      return perShare(f, ev - v(f, "net-debt")!, [
        { label: "EBITDA", unit: "currency", value: v(f, "ebitda")! },
        { label: "x peer EV/EBITDA", unit: "multiple", value: a.multiple },
        { label: "Enterprise value", unit: "currency", value: ev },
        { label: "- net debt", unit: "currency", value: v(f, "net-debt")! },
        { label: "Equity value", unit: "currency", value: ev - v(f, "net-debt")! },
      ]);
    },
  },
  {
    id: "analyst-targets",
    name: "Analyst price targets",
    family: "Market",
    description: "What sell-side analysts covering the stock publish as 12-month price targets: low, mean, high.",
    assumptions: [],
    notApplicable: (f) => (f.targets ? null : "No analyst publishes a price target on this stock (free sources)."),
    uses: () => [],
    compute: () => {
      throw new Error("analyst-targets: read, not computed");
    },
  },
];

export const methodSpec = (id: ValuationMethodId): MethodSpec => {
  const m = VALUATION_METHODS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown valuation method "${id}"`);
  return m;
};

/** Runs a method under the three scenarios; the scenario values are ordered low <= base <= high by the VALUE they give. */
export function runScenarios(spec: MethodSpec, f: ValuationFacts, scenarios: Record<Scenario, Values>, basis: string | null): { low: number; base: number; high: number; steps: ValuationStep[]; order: Scenario[] } {
  const out = (["low", "base", "high"] as Scenario[]).map((s) => ({ s, r: spec.compute(f, scenarios[s], basis) }));
  const sorted = [...out].sort((a, b) => a.r.value - b.r.value);
  const [lo, mid, hi] = sorted;
  const steps: ValuationStep[] = lo.r.steps.map((st, i) => ({ label: st.label, unit: st.unit, low: lo.r.steps[i].value, base: mid.r.steps[i].value, high: hi.r.steps[i].value }));
  return { low: lo.r.value, base: mid.r.value, high: hi.r.value, steps, order: sorted.map((x) => x.s) };
}

export const historyOf = (spec: MethodSpec, f: ValuationFacts): ValuationHistory =>
  spec.history && (f.history[spec.history.key]?.length ?? 0) > 0 ? { label: spec.history.label, unit: spec.history.unit, points: f.history[spec.history.key]! } : null;

/** Weighted fair value: weights normalised over the applicable methods; low / base / high each the weighted average. */
export function weighted(values: { method: ValuationMethodId; low: number; base: number; high: number }[], weights: Partial<Record<ValuationMethodId, number>>): { low: number; base: number; high: number; weights: Record<string, number> } {
  const used = values.filter((x) => (weights[x.method] ?? 0) > 0);
  const total = used.reduce((s, x) => s + weights[x.method]!, 0);
  if (!(total > 0)) throw new Error("valuation: every weight is zero");
  const w = Object.fromEntries(used.map((x) => [x.method, weights[x.method]! / total]));
  const sum = (k: "low" | "base" | "high") => used.reduce((s, x) => s + w[x.method] * x[k], 0);
  return { low: sum("low"), base: sum("base"), high: sum("high"), weights: w };
}
