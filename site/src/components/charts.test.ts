import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Site charts take every colour from the light chart theme of design/tokens.json (CSS classes), never a typed hex. */
describe("site charts", () => {
  for (const file of ["dark-chart.tsx", "ytd-chart.tsx"]) {
    it(`${file} types no colour`, () => {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(src.match(/#[0-9a-fA-F]{3,8}\b|\b(fill|stroke)="(white|black)"/g)).toBeNull();
    });
  }
});
