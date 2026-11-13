/**
 * Source tags as an equity research note prints them under a chart or a figure: "Source: Company filings (DART),
 * Yahoo Finance, Dualis Research." Thierry reads providers by name, never a tag, table or layer name (Kevin 2026-11-06).
 * Our own work (Claude's analysis, Thierry's edits) reads "Dualis Research", never labelled as Claude's.
 */
const FILINGS: Record<string, string> = {
  sec: "SEC EDGAR",
  "sec-edgar": "SEC EDGAR",
  "sec-filings": "SEC EDGAR",
  dart: "DART",
  edinet: "EDINET",
  tdnet: "TDnet",
  "companies-house": "Companies House",
  hkexnews: "HKEXnews",
  hkex: "HKEXnews",
  asx: "ASX",
};
const PROVIDERS: Record<string, string> = {
  yahoo: "Yahoo Finance",
  "yahoo-chart": "Yahoo Finance",
  "yahoo-fundamentals": "Yahoo Finance",
  nasdaq: "Nasdaq",
  finnhub: "Finnhub",
  fmp: "Financial Modeling Prep",
  "fmp-logo": "Financial Modeling Prep",
  cnbc: "CNBC",
  naver: "Naver Finance",
  tmx: "TMX",
  "pdf-extract": "Company annual report",
  "google-news": "Google News",
  wikidata: "Wikidata",
  wikipedia: "Wikipedia",
  onedrive: "Analyst research files",
  "onedrive-filings": "Analyst research files",
  substack: "Substack",
  "substack-rss": "Substack",
  "substack-archive": "Substack",
};
const OURS = new Set(["claude", "research", "rules", "dualis", "console", "watchlist", "whatsapp"]);
export const OWN_WORK = "Dualis Research";

export function sourceLabel(tag: string): string {
  if (FILINGS[tag]) return `Company filings (${FILINGS[tag]})`;
  if (PROVIDERS[tag]) return PROVIDERS[tag];
  if (OURS.has(tag)) return OWN_WORK;
  return tag.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** "Source: …." in the order a research note uses: company filings, data providers, our own work last. */
export function sourceNote(tags: string[]): string | null {
  const labels = [...new Set(tags.map(sourceLabel))];
  if (labels.length === 0) return null;
  const rank = (l: string) => (l.startsWith("Company filings") ? 0 : l === OWN_WORK ? 2 : 1);
  return `Source: ${labels.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).join(", ")}.`;
}
