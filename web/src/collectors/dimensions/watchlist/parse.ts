export type Market = "US" | "CA" | "JP" | "KR" | "UK" | "HK" | "AU" | "EU";

const SUFFIX_MARKET: Record<string, Market> = {
  T: "JP",
  KS: "KR",
  KQ: "KR",
  L: "UK",
  HK: "HK",
  TO: "CA",
  V: "CA",
  CN: "CA",
  AX: "AU",
  PA: "EU",
  DE: "EU",
  AS: "EU",
  MI: "EU",
  SW: "EU",
};

/** Market from the exchange suffix Thierry's tickers use (no suffix = US). */
export function marketOf(symbol: string): Market {
  const dot = symbol.lastIndexOf(".");
  if (dot === -1) return "US";
  const suffix = symbol.slice(dot + 1);
  const market = SUFFIX_MARKET[suffix];
  if (!market) throw new Error(`unknown market suffix ".${suffix}" in ${symbol}`);
  return market;
}

export type WatchlistRow = {
  symbol: string;
  market: Market;
  name: string | null;
  aliases: string[];
  thesisNote: string | null;
  inPortfolio: boolean;
  /** In the analysis scope (`analysis_scope`): every heavy dimension (judges, LLM, registries) runs on these only. */
  analysed: boolean;
};

type WatchlistFile = {
  portfolio?: string[];
  watchlist: string[];
  ticker_names?: Record<string, string>;
  ticker_aliases?: Record<string, string>;
  thesis_notes?: Record<string, string>;
  /** Tickers the analysis runs on while the product is refined (Kevin 2026-11-05). Absent = every ticker. */
  analysis_scope?: string[];
};

/** Turns data/watchlist.json (Thierry's stock-digest config shape) into ticker rows, portfolio first. */
export function parseWatchlist(input: unknown): WatchlistRow[] {
  const file = input as WatchlistFile;
  if (!file || !Array.isArray(file.watchlist)) {
    throw new Error("watchlist file has no `watchlist` array");
  }
  const portfolio = file.portfolio ?? [];
  const symbols = [...new Set([...portfolio, ...file.watchlist])];
  const scope = file.analysis_scope;
  const outside = (scope ?? []).filter((s) => !symbols.includes(s));
  if (outside.length) throw new Error(`analysis_scope names tickers absent from the watchlist and portfolio: ${outside.join(", ")}`);
  return symbols.map((symbol) => ({
    symbol,
    market: marketOf(symbol),
    name: file.ticker_names?.[symbol] ?? null,
    aliases: (file.ticker_aliases?.[symbol] ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    thesisNote: file.thesis_notes?.[symbol] ?? null,
    inPortfolio: portfolio.includes(symbol),
    analysed: scope ? scope.includes(symbol) : true,
  }));
}
