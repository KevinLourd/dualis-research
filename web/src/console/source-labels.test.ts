import { describe, expect, it } from "vitest";
import { sourceLabel, sourceNote } from "./source-labels";

describe("sources as an equity research note prints them", () => {
  it("names each provider in plain words, filings first, our own work last, no duplicates", () => {
    expect(sourceNote(["claude", "yahoo", "dart", "yahoo-chart", "naver"])).toBe("Source: Company filings (DART), Naver Finance, Yahoo Finance, Dualis Research.");
    expect(sourceNote(["console"])).toBe("Source: Dualis Research.");
    expect(sourceNote([])).toBeNull();
  });
  it("never shows a layer or table name", () => {
    for (const s of ["sec", "sec-edgar", "edinet", "tdnet", "pdf-extract", "google-news", "fmp", "research"]) expect(sourceLabel(s)).not.toMatch(/gold|silver|bronze|-/);
  });
});
