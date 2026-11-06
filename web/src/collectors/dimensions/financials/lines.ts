/**
 * The canonical line catalogue: every source maps its own labels onto these keys.
 * Values in full currency units; outflows (capex, dividends paid, buybacks) are POSITIVE.
 */
export type Statement = "income" | "balance" | "cashflow" | "market" | "segment";
export type PeriodType = "year" | "quarter" | "month";

export const LINES = {
  // Income statement (a period's flow)
  revenue: { statement: "income", name: "Revenue" },
  "cost-of-revenue": { statement: "income", name: "Cost of revenue" },
  "gross-profit": { statement: "income", name: "Gross profit" },
  sga: { statement: "income", name: "Selling, general and administrative" },
  rnd: { statement: "income", name: "Research and development" },
  "operating-income": { statement: "income", name: "Operating income" },
  "ordinary-income": { statement: "income", name: "Ordinary income (Japan GAAP)" },
  "depreciation-amortization": { statement: "income", name: "Depreciation and amortization" },
  "ebitda-reported": { statement: "income", name: "EBITDA as the source computes it" },
  "interest-expense": { statement: "income", name: "Interest expense" },
  "pretax-income": { statement: "income", name: "Pretax income" },
  "income-tax": { statement: "income", name: "Income tax" },
  "net-income": { statement: "income", name: "Net income attributable to shareholders" },
  "eps-basic": { statement: "income", name: "EPS, basic" },
  "eps-diluted": { statement: "income", name: "EPS, diluted" },
  "shares-diluted-avg": { statement: "income", name: "Diluted weighted average shares" },
  // Balance sheet (a point in time: the period end)
  cash: { statement: "balance", name: "Cash and equivalents" },
  "short-term-investments": { statement: "balance", name: "Short-term investments" },
  receivables: { statement: "balance", name: "Receivables" },
  inventory: { statement: "balance", name: "Inventory" },
  "current-assets": { statement: "balance", name: "Current assets" },
  ppe: { statement: "balance", name: "Property, plant and equipment" },
  goodwill: { statement: "balance", name: "Goodwill" },
  "total-assets": { statement: "balance", name: "Total assets" },
  "current-liabilities": { statement: "balance", name: "Current liabilities" },
  "short-term-debt": { statement: "balance", name: "Short-term debt and current portion" },
  "long-term-debt": { statement: "balance", name: "Long-term debt" },
  "total-debt": { statement: "balance", name: "Total debt" },
  "total-liabilities": { statement: "balance", name: "Total liabilities" },
  equity: { statement: "balance", name: "Shareholders' equity" },
  "total-equity": { statement: "balance", name: "Total equity incl. minorities" },
  "shares-outstanding": { statement: "balance", name: "Shares outstanding" },
  "shares-issued": { statement: "balance", name: "Shares issued (incl. treasury)" },
  // Cash flow statement (a period's flow)
  cfo: { statement: "cashflow", name: "Cash from operations" },
  capex: { statement: "cashflow", name: "Capital expenditure" },
  "fcf-reported": { statement: "cashflow", name: "Free cash flow as the source computes it" },
  cfi: { statement: "cashflow", name: "Cash from investing" },
  cff: { statement: "cashflow", name: "Cash from financing" },
  "dividends-paid": { statement: "cashflow", name: "Dividends paid" },
  buybacks: { statement: "cashflow", name: "Share buybacks" },
  "stock-compensation": { statement: "cashflow", name: "Stock-based compensation" },
  // Market (month-end close, for EV at each fiscal period end)
  "share-price": { statement: "market", name: "Share price, month-end close" },
} as const satisfies Record<string, { statement: Statement; name: string }>;

export type LineKey = keyof typeof LINES;
export const isLineKey = (k: string): k is LineKey => k in LINES;

/** Segment revenue rows: `segment:<axis>:<name>` (axis = product, region, customer). */
export const segmentLine = (axis: string, name: string) => `segment:${axis}:${name.trim()}`;
export const statementOf = (line: string): Statement => (line.startsWith("segment:") ? "segment" : LINES[line as LineKey].statement);

/** Lines stored positive whatever sign the source uses (outflows). */
export const POSITIVE_LINES: readonly LineKey[] = ["capex", "dividends-paid", "buybacks"];

/** One value as a source reads it. `periodEnd` = "YYYY-MM". */
export type LineReading = {
  periodType: PeriodType;
  periodEnd: string;
  line: string;
  value: number;
  currency: string | null;
  label: string;
  consolidated: boolean | null;
  citation?: { document: string; url: string; page: number; quote?: string } | null;
};

export const reading = (r: LineReading): LineReading =>
  POSITIVE_LINES.includes(r.line as LineKey) ? { ...r, value: Math.abs(r.value) } : r;
