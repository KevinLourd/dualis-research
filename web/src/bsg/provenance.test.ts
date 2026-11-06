import { describe, expect, it } from "vitest";
import { applyAssertions, pickWinner, valueKey } from "./provenance";

const opts = { priority: ["watchlist", "fmp", "finnhub", "yahoo"], manual: ["watchlist"] };

describe("applyAssertions (multi-source provenance)", () => {
  it("one fact carries EVERY source that agrees, never first-found", () => {
    const facts = applyAssertions([], [
      { source: "fmp", field: "name", value: "Monro, Inc.", bronzeId: "b1" },
      { source: "finnhub", field: "name", value: "Monro Inc", bronzeId: "b2" },
      { source: "yahoo", field: "name", value: "MONRO, INC.", bronzeId: "b3" },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].sources).toEqual(["fmp", "finnhub", "yahoo"]);
    expect(facts[0].bronzeIds).toEqual(["b1", "b2", "b3"]);
    expect(facts[0].value).toBe("Monro, Inc.");
  });

  it("keeps disagreeing values as separate candidates", () => {
    const facts = applyAssertions([], [
      { source: "fmp", field: "exchange", value: "NASDAQ", bronzeId: "b1" },
      { source: "yahoo", field: "exchange", value: "NasdaqGS", bronzeId: "b2" },
    ]);
    expect(facts.map((f) => f.sources)).toEqual([["fmp"], ["yahoo"]]);
  });

  it("a source that changes its answer moves to the new value; an unasserted value disappears", () => {
    const first = applyAssertions([], [{ source: "fmp", field: "marketCap", value: 100, bronzeId: "b1" }]);
    const next = applyAssertions(first, [{ source: "fmp", field: "marketCap", value: 120, bronzeId: "b2" }]);
    expect(next).toEqual([{ field: "marketCap", value: 120, valueKey: "120", sources: ["fmp"], bronzeIds: ["b2"] }]);
  });

  it("a source with nothing to say keeps its previous answer", () => {
    const first = applyAssertions([], [{ source: "fmp", field: "website", value: "https://a.com", bronzeId: "b1" }]);
    expect(applyAssertions(first, [{ source: "fmp", field: "website", value: "", bronzeId: "b2" }])).toEqual(first);
  });

  it("an object compares equal whatever its key order (Postgres jsonb reorders keys)", () => {
    expect(valueKey({ title: "A", text: "B" })).toBe(valueKey({ text: "B", title: "A" }));
  });

  it("normalizes case, spacing and punctuation", () => {
    expect(valueKey("https://www.monro.com/")).toBe(valueKey("https://www.monro.com"));
    expect(valueKey("Miraial Co., Ltd.")).toBe(valueKey("MIRAIAL CO LTD"));
  });
});

describe("pickWinner", () => {
  const fact = (value: string, sources: string[]) => ({ field: "name", value, valueKey: valueKey(value), sources, bronzeIds: sources });

  it("Thierry's manual value wins over a majority", () => {
    expect(pickWinner([fact("A", ["fmp", "finnhub"]), fact("B", ["watchlist"])], opts)?.value).toBe("B");
  });
  it("then the value most sources agree on", () => {
    expect(pickWinner([fact("A", ["fmp"]), fact("B", ["finnhub", "yahoo"])], opts)?.value).toBe("B");
  });
  it("then the highest-priority source", () => {
    expect(pickWinner([fact("A", ["yahoo"]), fact("B", ["fmp"])], opts)?.value).toBe("B");
  });
  it("returns null when nobody knows", () => {
    expect(pickWinner([], opts)).toBeNull();
  });
});
