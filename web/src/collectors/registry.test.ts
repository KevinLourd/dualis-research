import { describe, expect, it } from "vitest";
import { collectPlan, DIMENSIONS, GROWTH_DIMENSIONS, ON_DEMAND_DIMENSIONS, dimensionsFor } from "./registry";

describe("collect groups", () => {
  it("core = every dimension but Growth/content; growth = those; both cover all", () => {
    expect(GROWTH_DIMENSIONS.every((n) => DIMENSIONS.some((d) => d.name === n))).toBe(true);
    const core = dimensionsFor("core").map((d) => d.name);
    expect(core).toContain("analysis");
    expect(core).not.toContain("substack-network");
    expect([...core, ...dimensionsFor("growth").map((d) => d.name), ...ON_DEMAND_DIMENSIONS].sort()).toEqual(DIMENSIONS.map((d) => d.name).sort());
    expect(dimensionsFor("financials").map((d) => d.name)).toEqual(["financials"]);
  });

  it("x-publish posts for real: only when named, never in all / core / growth / a merge's collect", () => {
    for (const g of ["all", "core", "growth", "from:watchlist"]) expect(dimensionsFor(g).map((d) => d.name)).not.toContain("x-publish");
    expect(dimensionsFor("x-publish").map((d) => d.name)).toEqual(["x-publish"]);
    expect(collectPlan(["web/src/collectors/dimensions/x-publish/index.ts"])).toBeNull();
  });
});
