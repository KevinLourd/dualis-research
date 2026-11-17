import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { financialMetrics, goldFinancialLines } from "@/db/schema/financials";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { figuresText, gatherFacts } from "./dimensions/analysis/facts";
import { seriesCatalog } from "./dimensions/analysis/series";
import { deriveMetrics } from "./dimensions/financials/derive";

/**
 * Leverage read against earnings (Thierry 2026-11-17: Kyungbang's « net debt is still large versus market cap » was
 * wrong, its debt is about 2x EBITDA). Figures invented for the test, in the shape of a Korean filer (KRW).
 */
type L = { periodType: "year" | "quarter"; periodEnd: string; line: string; value: number; currency: string; sources: string[] };
const l = (periodType: L["periodType"], periodEnd: string, line: string, value: number): L => ({ periodType, periodEnd, line, value, currency: "KRW", sources: ["dart"] });
const YEAR = [
  l("year", "2025-12", "revenue", 400e9),
  l("year", "2025-12", "operating-income", 70e9),
  l("year", "2025-12", "depreciation-amortization", 21e9),
  l("year", "2025-12", "total-debt", 200e9),
  l("year", "2025-12", "cash", 20e9),
  l("year", "2025-12", "interest-expense", 10e9),
];
const QUARTERS = ["2025-12", "2026-03", "2026-06", "2026-09"].flatMap((pe) => [
  l("quarter", pe, "operating-income", 20e9),
  l("quarter", pe, "depreciation-amortization", 5e9),
  l("quarter", pe, "interest-expense", -2e9),
]);
const Q3 = [l("quarter", "2026-09", "total-debt", 150e9), l("quarter", "2026-09", "cash", 50e9)];

describe("leverage against earnings", () => {
  it("derives net debt / EBITDA, total debt / EBITDA and interest cover with formula and inputs", () => {
    const m = deriveMetrics("000050.KS", YEAR);
    const get = (metric: string) => m.find((x) => x.metric === metric && x.periodType === "year" && x.periodEnd === "2025-12");
    expect(get("net-debt-to-ebitda")).toMatchObject({ value: 180 / 91, unit: "multiple", currency: null, sources: ["dart"] });
    expect(get("net-debt-to-ebitda")!.formula).toContain("(total debt - cash and equivalents) / EBITDA of the fiscal year");
    expect(get("net-debt-to-ebitda")!.inputs.map((i) => i.line).sort()).toEqual(["cash", "depreciation-amortization", "operating-income", "total-debt"]);
    expect(get("total-debt-to-ebitda")!.value).toBeCloseTo(200 / 91, 12);
    expect(get("interest-cover")).toMatchObject({ value: 7, formula: "operating income / interest expense, fiscal year" });
  });

  it("a quarter reads the EBITDA and interest of the last 4 reported quarters", () => {
    const m = deriveMetrics("X", [...QUARTERS, ...Q3]);
    const get = (metric: string) => m.find((x) => x.metric === metric && x.periodType === "quarter" && x.periodEnd === "2026-09");
    expect(get("net-debt-to-ebitda")!.value).toBeCloseTo(100 / 100, 12);
    expect(get("net-debt-to-ebitda")!.inputs).toHaveLength(2 + 8);
    expect(get("total-debt-to-ebitda")!.value).toBeCloseTo(1.5, 12);
    expect(get("interest-cover")!.value).toBeCloseTo(80 / 8, 12);
    // An earlier quarter without 4 quarters behind it gets no ratio.
    expect(m.some((x) => x.metric === "net-debt-to-ebitda" && x.periodEnd === "2026-06")).toBe(false);
  });

  it("no EBITDA, or EBITDA at or below zero, gives no ratio row (never a zero)", () => {
    const noDa = deriveMetrics("X", YEAR.filter((x) => x.line !== "depreciation-amortization"));
    expect(noDa.some((x) => x.metric.endsWith("-to-ebitda"))).toBe(false);
    const loss = deriveMetrics("X", YEAR.map((x) => (x.line === "operating-income" ? { ...x, value: -30e9 } : x)));
    expect(loss.some((x) => x.metric.endsWith("-to-ebitda") || x.metric === "interest-cover")).toBe(false);
  });

  describe("what the judges read", () => {
    let db: Db;
    let close: () => Promise<void>;
    beforeEach(async () => ({ db, close } = await testDb()));
    afterEach(async () => close());

    it("figuresText and the analysis facts carry Net debt / EBITDA beside debt and cash", async () => {
      const symbol = "000050.KS";
      await db.insert(goldFinancialLines).values(YEAR.map((x) => ({ symbol, ...x, statement: "income" as const, label: x.line, alternatives: [] })));
      await db.insert(financialMetrics).values(deriveMetrics(symbol, YEAR));
      const figures = await figuresText(db, symbol);
      expect(figures).toContain("Balance sheet and leverage");
      expect(figures).toMatch(/Net debt \/ EBITDA \[metric:net-debt-to-ebitda\] \| 2\.0x/);
      expect(figures).toMatch(/Interest cover \(operating income \/ interest expense\) \[metric:interest-cover\] \| 7\.0x/);
      const facts = await gatherFacts(db, symbol);
      expect(facts.text).toContain("Net debt / EBITDA");
      expect((await seriesCatalog(db, symbol)).get("metric:total-debt-to-ebitda")).toMatchObject({ label: "Total debt / EBITDA", unit: "multiple" });
      expect(await figuresText(db, "NOPE")).not.toContain("Balance sheet");
    });
  });
});
