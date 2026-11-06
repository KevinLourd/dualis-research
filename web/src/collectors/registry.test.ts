import { describe, expect, it } from "vitest";
import { DIMENSIONS, GROWTH_DIMENSIONS, dimensionsFor } from "./registry";

describe("collect groups", () => {
  it("core = every dimension but Growth/content; growth = those; both cover all", () => {
    expect(GROWTH_DIMENSIONS.every((n) => DIMENSIONS.some((d) => d.name === n))).toBe(true);
    const core = dimensionsFor("core").map((d) => d.name);
    expect(core).toContain("analysis");
    expect(core).not.toContain("substack-network");
    expect([...core, ...dimensionsFor("growth").map((d) => d.name)].sort()).toEqual(DIMENSIONS.map((d) => d.name).sort());
    expect(dimensionsFor("financials").map((d) => d.name)).toEqual(["financials"]);
  });
});
