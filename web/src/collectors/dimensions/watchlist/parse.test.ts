import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { marketOf, parseWatchlist } from "./parse";

const real = JSON.parse(
  readFileSync(join(__dirname, "../../../test/fixtures/private/data/watchlist.json"), "utf8"),
);

describe("marketOf", () => {
  it.each([
    ["NVRI", "US"],
    ["4238.T", "JP"],
    ["101160.KQ", "KR"],
    ["267290.KS", "KR"],
    ["AT.L", "UK"],
    ["1161.HK", "HK"],
    ["DRX.TO", "CA"],
    ["RW.V", "CA"],
    ["LFLR.CN", "CA"],
    ["EOS.AX", "AU"],
    ["ALLOG.PA", "EU"],
    ["LPK.DE", "EU"],
  ])("%s -> %s", (symbol, market) => {
    expect(marketOf(symbol)).toBe(market);
  });

  it("throws on an unknown suffix", () => {
    expect(() => marketOf("ABC.ZZ")).toThrow(/unknown market suffix/);
  });
});

describe("parseWatchlist", () => {
  it("imports Thierry's real watchlist: 37 tickers, 4 in portfolio", () => {
    const rows = parseWatchlist(real);
    expect(rows).toHaveLength(37);
    expect(rows.filter((r) => r.inPortfolio).map((r) => r.symbol)).toEqual([
      "SPCB",
      "4238.T",
      "101160.KQ",
      "1161.HK",
    ]);
  });

  it("carries names, aliases and thesis notes", () => {
    const rows = parseWatchlist(real);
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    expect(bySymbol.get("4238.T")?.name).toBe("Miraial Co Ltd");
    expect(bySymbol.get("CNRD")?.aliases).toEqual([
      "Conrad Shipyard",
      "Conrad Industries",
    ]);
    expect(bySymbol.get("MNRO")?.thesisNote).toMatch(/Icahn/);
    expect(bySymbol.get("NVRI")?.thesisNote).toBeNull();
  });

  it("merges a symbol listed in both portfolio and watchlist", () => {
    const rows = parseWatchlist({ portfolio: ["OBE"], watchlist: ["OBE", "MX"] });
    expect(rows).toEqual([
      expect.objectContaining({ symbol: "OBE", inPortfolio: true }),
      expect.objectContaining({ symbol: "MX", inPortfolio: false }),
    ]);
  });

  it("refuses a file without a watchlist", () => {
    expect(() => parseWatchlist({ portfolio: [] })).toThrow(/watchlist/);
  });

  it("analysis scope: only the listed tickers are analysed; a ticker outside the file is refused; no scope = every ticker", () => {
    const rows = parseWatchlist({ portfolio: ["101160.KQ"], watchlist: ["MNRO", "267290.KS"], analysis_scope: ["101160.KQ", "267290.KS"] });
    expect(rows.map((r) => [r.symbol, r.analysed])).toEqual([["101160.KQ", true], ["MNRO", false], ["267290.KS", true]]);
    expect(() => parseWatchlist({ watchlist: ["MNRO"], analysis_scope: ["QMCO"] })).toThrow(/QMCO/);
    expect(parseWatchlist({ watchlist: ["MNRO"] })[0].analysed).toBe(true);
  });
});
