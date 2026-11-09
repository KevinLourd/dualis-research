import { describe, expect, it } from "vitest";
import { buildFormation, formationCount, type Variant } from "./poker-formations";

const VARIANTS: Variant[] = ["home", "company", "research", "portfolio", "about", "contact", "plans"];

describe("poker formations", () => {
  it.each(VARIANTS)("%s fills every point with a finite position inside the scene", (variant) => {
    for (let k = 0; k < formationCount(variant); k++) {
      const f = buildFormation(variant, k, 1400);
      expect(f.x.length).toBe(1400);
      for (let i = 0; i < 1400; i++) {
        for (const v of [f.x[i], f.y[i], f.z[i]]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(Math.abs(v)).toBeLessThan(4);
        }
      }
    }
  });

  it("draws the same scene every time (seeded)", () => {
    expect(Array.from(buildFormation("home", 0, 200).x)).toEqual(Array.from(buildFormation("home", 0, 200).x));
  });

  it("company walks from three tables to the one we pick", () => {
    expect(formationCount("company")).toBe(2);
  });
});
