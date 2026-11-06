import type { SourceContext } from "./types";
import { marketOf, type Market } from "./dimensions/watchlist/parse";
import dartCorpCodes from "./ids/dart-corp-codes.json";
import companiesHouse from "./ids/companies-house.json";

/**
 * Per-market routing of Thierry's tickers to the free source that answers them, ported from his stock-digest
 * (`get_market`, `ticker_base`, `dart_codes.json`, `ch_codes.json`).
 */
export { marketOf, type Market };

/** Stock code without the exchange suffix ("4238.T" -> "4238"). */
export function tickerBase(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot === -1 ? symbol : symbol.slice(0, dot);
}

export const suffixOf = (symbol: string): string => {
  const dot = symbol.lastIndexOf(".");
  return dot === -1 ? "" : symbol.slice(dot + 1);
};

export const isMarket = (...markets: Market[]) => (symbol: string) => markets.includes(marketOf(symbol));

/** OpenDART corp_code for a Korean listing (.KS / .KQ), from DART's corpCode.xml (cached in ids/). */
export function dartCorpCode(symbol: string): string | null {
  return (dartCorpCodes as Record<string, string>)[tickerBase(symbol)] ?? null;
}

/**
 * Companies House number for a UK listing. Checked by hand against the register: Thierry's ch_codes.json had
 * AT -> 05023853, which is "AT LIMITED", not Ashtead Technology Holdings plc (13424040).
 */
export function companiesHouseNumber(symbol: string): string | null {
  return (companiesHouse as Record<string, string>)[symbol] ?? null;
}

/** Canadian listings TMX Money answers: Toronto (.TO) and TSX Venture (.V). The CSE (.CN) is not on TMX. */
export const isTmxSymbol = (symbol: string) => ["TO", "V"].includes(suffixOf(symbol));

/** A browser-like User-Agent: Yahoo, Nasdaq, TMX and HKEXnews refuse bare clients. */
export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

/** SEC asks every client to name itself with a contact address. */
export const SEC_HEADERS = { "User-Agent": "Dualis Research research@dualisresearch.com" };

/**
 * Per-run memo for lookups several subjects share (SEC ticker map, an EDINET day list): one fetch per run,
 * keyed on the run's context so tests never share a cache.
 */
const memos = new WeakMap<SourceContext, Map<string, Promise<unknown>>>();
export function memo<T>(ctx: SourceContext, key: string, load: () => Promise<T>): Promise<T> {
  let m = memos.get(ctx);
  if (!m) memos.set(ctx, (m = new Map()));
  if (!m.has(key)) m.set(key, load());
  return m.get(key) as Promise<T>;
}

/** "2026-11-04" for a Date, in UTC. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 86_400_000);
