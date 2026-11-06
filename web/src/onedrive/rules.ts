import { tickerBase } from "@/collectors/markets";

/** The only folder we write files into, one per company folder. */
export const FILINGS_FOLDER = "Filings (Dualis)";

export type TickerNames = { symbol: string; name: string | null; aliases: string[] };
export type FolderMatch = { symbol: string; matchedBy: "symbol" | "name" | "alias" };

const SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "sa", "ag", "nv", "se", "holdings", "holding", "group", "the", "kk", "llc", "lp"]);

/** Lowercase words without punctuation or company suffixes. */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !SUFFIXES.has(w));
}

const containsPhrase = (hay: string[], needle: string[]) =>
  needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));

/**
 * Ties a company folder to ONE watchlist ticker: its ticker as a word ("MNRO", "4238"), else the company name, else an
 * alias. Two tickers matching at the same level = no match (we never guess).
 */
export function matchFolder(folderName: string, tickers: TickerNames[]): FolderMatch | null {
  const hay = words(folderName);
  const levels: [FolderMatch["matchedBy"], (t: TickerNames) => boolean][] = [
    // A one-letter ticker ("E.TO") is too common a word to identify a folder alone.
    ["symbol", (t) => tickerBase(t.symbol).length > 1 && containsPhrase(hay, words(tickerBase(t.symbol)))],
    ["name", (t) => !!t.name && containsPhrase(hay, words(t.name))],
    ["alias", (t) => t.aliases.some((a) => containsPhrase(hay, words(a)))],
  ];
  for (const [matchedBy, test] of levels) {
    const hits = tickers.filter(test);
    if (hits.length === 1) return { symbol: hits[0].symbol, matchedBy };
    if (hits.length > 1) return null;
  }
  return null;
}

/** Name of a folder we create for a ticker with none: "Monro Inc (MNRO)". */
export function newFolderName(t: TickerNames): string {
  return safeName(t.name ? `${t.name} (${t.symbol})` : t.symbol);
}

/** What a document is, from its name and path. */
export function documentKind(path: string, name: string): "filing" | "model" | "transcript" | "presentation" | "note" | "other" {
  const n = name.toLowerCase();
  const p = path.toLowerCase();
  if (/\.(xlsx|xlsm|xls|csv)$/.test(n)) return "model";
  if (/transcript/.test(p)) return "transcript";
  if (/\.(pptx?|key)$/.test(n) || /presentation|investor day|deck/.test(p)) return "presentation";
  if (/\.(md|txt|docx?|one)$/.test(n) && !/filing/.test(p)) return "note";
  if (/filing|10-k|10-q|20-f|annual report|interim|semi-annual|half[- ]year|有価証券|決算短信|사업보고서/.test(p)) return "filing";
  return "other";
}

/** Small text notes we read into the thesis research. */
export const isReadableNote = (name: string, size: number | undefined) => /\.(md|txt)$/i.test(name) && (size ?? 0) <= 200_000;

/**
 * Core filings = the periodic reports (annual, semi-annual, quarterly) per registry; announcements are not saved.
 * ASX is left out: our feed only links the company's announcement list, not the document.
 */
export function isCoreFiling(f: { registry: string; form: string | null; title: string }): boolean {
  const form = f.form ?? "";
  const text = `${form} ${f.title}`;
  switch (f.registry) {
    case "sec":
      return /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)(\/A)?$/.test(form);
    case "edinet":
      return ["120", "140", "160"].includes(form);
    case "tdnet":
      return /決算短信/.test(f.title);
    case "dart":
      return /사업보고서|반기보고서|분기보고서/.test(f.title);
    case "companies-house":
      return /^AA/.test(form);
    case "hkex":
      return /annual report|interim report/i.test(text);
    default:
      return false;
  }
}

/** OneDrive forbids " * : < > ? / \ | and trailing dots or spaces; keep names short. */
export function safeName(s: string, max = 150): string {
  return s
    .replace(/["*:<>?/\\|#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[.\s]+$/, "");
}

/** "2026-11-03 10-Q Quarterly report.pdf" */
export function filingFileName(f: { filedAt: Date; form: string | null; title: string }, ext: string): string {
  const date = f.filedAt.toISOString().slice(0, 10);
  const form = f.form && !/^\d+$/.test(f.form) && !f.title.includes(f.form) ? `${f.form} ` : "";
  return `${safeName(`${date} ${form}${f.title}`, 140)}.${ext}`;
}

/** File extension from the answer's content type, else the URL. */
export function extensionOf(contentType: string | null, url: string): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("html")) return "htm";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("zip")) return "zip";
  const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : "bin";
}

/** A Windows/OneDrive web shortcut, for registries whose filing is a viewer page (DART). */
export const urlShortcut = (url: string) => `[InternetShortcut]\r\nURL=${url}\r\n`;
export const isViewerPage = (registry: string) => registry === "dart";
