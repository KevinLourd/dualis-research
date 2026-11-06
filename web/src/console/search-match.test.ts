import { describe, expect, it } from "vitest";
import { queryWords, rowMatches } from "./search-match";

describe("table search", () => {
  it("keeps every row on an empty query", () => {
    expect(rowMatches("Miraial 4238.T", queryWords("   "))).toBe(true);
  });
  it("ignores case and accents", () => {
    expect(rowMatches("Nikkéi Holdings", queryWords("NIKKEI"))).toBe(true);
  });
  it("needs every word, in any order", () => {
    expect(
      rowMatches("Quantum Corp QMCO 2.31 USD", queryWords("qmco quantum")),
    ).toBe(true);
    expect(rowMatches("Quantum Corp QMCO", queryWords("quantum miraial"))).toBe(
      false,
    );
  });
  it("matches a ticker symbol with its dot", () => {
    expect(rowMatches("Miraial 4238.T", queryWords("4238.t"))).toBe(true);
    expect(rowMatches("Miraial 4238.T", queryWords("4239"))).toBe(false);
  });
});
