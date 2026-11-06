import { describe, expect, it } from "vitest";
import { returnLines } from "./portfolio-series";

const bars = new Map([
  ["A", [{ date: "2026-01-01", close: 90 }, { date: "2026-01-02", close: 100 }, { date: "2026-01-03", close: 110 }]],
  ["B", [{ date: "2026-01-02", close: 50 }, { date: "2026-01-03", close: 40 }]],
]);
const spx = [{ date: "2026-01-01", close: 1000 }, { date: "2026-01-02", close: 1010 }, { date: "2026-01-03", close: 1020 }];

describe("portfolio return lines", () => {
  it("one line per position since its entry (short flipped) + the S&P rebased at the first entry, no aggregate without weights", () => {
    const lines = returnLines(
      [
        { symbol: "A", direction: "long", entryDate: "2026-01-02", entryPrice: 100, weight: null },
        { symbol: "B", direction: "short", entryDate: "2026-01-02", entryPrice: 50, weight: null },
      ],
      bars,
      spx,
      false,
    );
    expect(lines.map((l) => l.name)).toEqual(["A", "B", "S&P 500"]);
    expect(lines[0].points).toEqual([{ date: "2026-01-02", value: 0 }, { date: "2026-01-03", value: expect.closeTo(0.1) }]);
    expect(lines[1].points[1].value).toBeCloseTo(0.2);
    expect(lines[2].points[0]).toEqual({ date: "2026-01-02", value: 0 });
    expect(lines[2].points[1].value).toBeCloseTo(0.0099, 3);
  });

  it("adds the weighted portfolio line when every position is weighted", () => {
    const lines = returnLines(
      [
        { symbol: "A", direction: "long", entryDate: "2026-01-02", entryPrice: 100, weight: 0.75 },
        { symbol: "B", direction: "short", entryDate: "2026-01-02", entryPrice: 50, weight: 0.25 },
      ],
      bars,
      spx,
      true,
    );
    expect(lines[0].name).toBe("Portfolio");
    expect(lines[0].points[1].value).toBeCloseTo(0.75 * 0.1 + 0.25 * 0.2);
  });

  it("nothing to draw without an entry", () => {
    expect(returnLines([], bars, spx, false)).toEqual([]);
  });
});
