import { eq } from "drizzle-orm";
import type { DocumentFormat, DocumentKind } from "@/db/schema/documents";
import { filings } from "@/db/schema/silver";
import { isCoreFiling } from "@/onedrive/rules";
import { BROWSER_HEADERS, SEC_HEADERS } from "../../markets";
import type { FetchOutcome, Source, SourceContext } from "../../types";
import { unzip } from "../financials/zip";
import { finalPages, htmlPages } from "./text";

/** Node-only modules (pdf.js), hidden from every bundler: the console Worker lists dimensions. */
const nodeImport = (spec: string): Promise<unknown> => import(/* webpackIgnore: true */ spec);

/** What a fetch lands in bronze: the document's pages as printed, and where it lives. */
export type DocumentPayload = {
  filingId: string;
  symbol: string;
  registry: string;
  kind: DocumentKind;
  documentUrl: string;
  viewUrl: string;
  format: DocumentFormat;
  bytes: number;
  pages: string[];
};

/**
 * Which filings we read, and as what. Core = the periodic reports (`isCoreFiling`, the same set saved to Thierry's
 * OneDrive); plus where management explains the period in its own words: the results press release (SEC 8-K item
 * 2.02 exhibit 99, HKEX results announcements) and the results presentation (TDnet 決算説明資料). Null = not read.
 */
export function documentKind(f: { registry: string; form: string | null; title: string }): DocumentKind | null {
  const text = `${f.form ?? ""} ${f.title}`;
  if (f.registry === "sec" && /^8-K(\/A)?$/.test(f.form ?? "") && /results of operations/i.test(f.title)) return "results-release";
  if (f.registry === "tdnet" && /決算説明|説明会資料|決算補足/.test(f.title)) return "presentation";
  if (f.registry === "hkex" && /results announcement|announcement of (annual|interim|final) results|(annual|interim|final) results for/i.test(text)) return "results-release";
  if (isCoreFiling(f)) return "report";
  return null;
}

/** A subject = one filing: "SYMBOL|registry|filing id" (the registry routes it to its source, the Data page reads it). */
export const subjectOf = (f: { symbol: string; registry: string; id: string }) => `${f.symbol}|${f.registry}|${f.id}`;
export function parseSubject(subject: string): { symbol: string; registry: string; filingId: string } {
  const [symbol, registry, filingId] = subject.split("|");
  return { symbol, registry, filingId };
}
const registryOf = (subject: string) => parseSubject(subject).registry;

type Filing = typeof filings.$inferSelect;
async function filingOf(ctx: SourceContext, subject: string): Promise<Filing> {
  const { filingId } = parseSubject(subject);
  const [f] = await ctx.db!.select().from(filings).where(eq(filings.id, filingId));
  if (!f) throw new Error(`filing ${filingId} is not in silver.filings`);
  if (!f.url) throw new Error(`filing ${filingId} has no document link`);
  return f;
}

const isPdf = (bytes: Uint8Array, contentType: string | null) => (contentType ?? "").includes("pdf") || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { pdfPages: read } = (await nodeImport(new URL("../financials/pdf-text.ts", import.meta.url).href)) as typeof import("../financials/pdf-text");
  return read(bytes);
}

/** A document whose pages hold less than this is a scanned image or a font without a text map: nothing to cite. */
const MIN_TEXT_CHARS = 200;

type Read = { documentUrl: string; viewUrl: string; format: DocumentFormat; bytes: number; pages: string[]; request: Record<string, unknown>; httpStatus: number };

/** Build the bronze answer: the pages, or a failure with its reason (a fetch error, an empty text layer). */
async function outcome(ctx: SourceContext, subject: string, read: (f: Filing) => Promise<Read | FetchOutcome>): Promise<FetchOutcome> {
  const f = await filingOf(ctx, subject);
  const kind = documentKind(f);
  if (!kind) return { request: { filingId: f.id }, httpStatus: null, error: `not a document we read: ${f.title}` };
  const r = await read(f);
  if (!("pages" in r)) return r;
  const pages = finalPages(r.pages);
  const chars = pages.reduce((n, p) => n + p.length, 0);
  const request = { ...r.request, filingId: f.id, kind };
  if (chars < MIN_TEXT_CHARS) return { request, httpStatus: r.httpStatus, error: `no text in the document (${pages.length} pages, ${chars} characters: a scanned image?)` };
  const payload: DocumentPayload = { filingId: f.id, symbol: f.symbol, registry: f.registry, kind, documentUrl: r.documentUrl, viewUrl: r.viewUrl, format: r.format, bytes: r.bytes, pages };
  return { request, httpStatus: r.httpStatus, payload };
}

/** `shown` = the url without its key, the only one that reaches bronze. */
async function download(ctx: SourceContext, url: string, headers: Record<string, string>, shown = url): Promise<{ res: Response; bytes: Uint8Array } | FetchOutcome> {
  const res = await ctx.fetch(url, { headers });
  if (!res.ok) return { request: { url: shown }, httpStatus: res.status, error: `HTTP ${res.status} from ${shown}` };
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A PDF or an HTML page at `url`, read into pages. */
async function readFile(ctx: SourceContext, url: string, headers: Record<string, string>, request: Record<string, unknown>): Promise<Read | FetchOutcome> {
  const d = await download(ctx, url, headers);
  if (!("res" in d)) return d;
  const contentType = d.res.headers.get("content-type");
  if (isPdf(d.bytes, contentType)) {
    return { documentUrl: url, viewUrl: url, format: "pdf", bytes: d.bytes.length, pages: await pdfPages(d.bytes), request: { ...request, url }, httpStatus: d.res.status };
  }
  if (/html|xml|text/.test(contentType ?? "") || /\.html?$/i.test(new URL(url).pathname)) {
    return { documentUrl: url, viewUrl: url, format: "html", bytes: d.bytes.length, pages: htmlPages(new TextDecoder().decode(d.bytes)), request: { ...request, url }, httpStatus: d.res.status };
  }
  return { request: { ...request, url }, httpStatus: d.res.status, error: `not a PDF or HTML document (${contentType ?? "no content type"})` };
}

// ---------- SEC EDGAR: the 10-K / 10-Q itself; an 8-K's press release exhibit (99.1) ----------

/** The exhibits of an EDGAR filing, from its index page: [type, absolute url]. */
export function secExhibits(indexHtml: string): { type: string; url: string }[] {
  const out: { type: string; url: string }[] = [];
  for (const row of indexHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const href = /<a href="([^"]+)"/i.exec(row)?.[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    if (!href || cells.length < 4) continue;
    const path = href.replace(/^\/ix\?doc=/, "");
    out.push({ type: cells[3], url: new URL(path, "https://www.sec.gov").href });
  }
  return out;
}

export const secDocument: Source = {
  name: "sec-document",
  requiredEnv: [],
  covers: (s) => registryOf(s) === "sec",
  concurrency: 3,
  fetch: (subject, ctx) =>
    outcome(ctx, subject, async (f) => {
      if (documentKind(f) !== "results-release") return readFile(ctx, f.url!, SEC_HEADERS, {});
      // An 8-K's own text is a cover page; the results are in its exhibit 99 (the press release).
      const indexUrl = `${f.url!.slice(0, f.url!.lastIndexOf("/"))}/${f.filingKey}-index.html`;
      const d = await download(ctx, indexUrl, SEC_HEADERS);
      if (!("res" in d)) return d;
      const exhibits = secExhibits(new TextDecoder().decode(d.bytes)).filter((e) => /^EX-99/i.test(e.type) && /\.(html?|pdf)$/i.test(e.url));
      const exhibit = exhibits.find((e) => /^EX-99\.1$/i.test(e.type)) ?? exhibits[0];
      return readFile(ctx, exhibit?.url ?? f.url!, SEC_HEADERS, { index: indexUrl, exhibit: exhibit?.type ?? "8-K" });
    }),
};

// ---------- PDF registries: TDnet, HKEXnews, Companies House ----------

export const pdfDocument: Source = {
  name: "registry-pdf",
  requiredEnv: [],
  covers: (s) => ["tdnet", "hkex", "companies-house"].includes(registryOf(s)),
  concurrency: 2,
  fetch: (subject, ctx) => outcome(ctx, subject, (f) => readFile(ctx, f.url!, { ...BROWSER_HEADERS, Accept: "*/*" }, {})),
};

// ---------- EDINET: the report's HTML sections (its PDF uses fonts pdf.js cannot read without CMaps) ----------

export const edinetDocument: Source = {
  name: "edinet-document",
  requiredEnv: ["EDINET_API_KEY"],
  covers: (s) => registryOf(s) === "edinet",
  fetch: (subject, ctx) =>
    outcome(ctx, subject, async (f) => {
      const url = `https://api.edinet-fsa.go.jp/api/v2/documents/${f.filingKey}?type=1`;
      const d = await download(ctx, `${url}&Subscription-Key=${ctx.env.EDINET_API_KEY}`, {}, url);
      if (!("res" in d)) return d;
      const files = await unzip(d.bytes).catch(() => null);
      if (!files) return { request: { url }, httpStatus: d.res.status, error: `EDINET ${f.filingKey}: answer is not a zip (${new TextDecoder().decode(d.bytes.slice(0, 200))})` };
      const sections = [...files.entries()].filter(([name]) => /PublicDoc\/[^/]+\.html?$/i.test(name)).sort(([a], [b]) => a.localeCompare(b));
      const pages = sections.flatMap(([, bytes]) => htmlPages(new TextDecoder().decode(bytes)));
      return { documentUrl: url, viewUrl: f.url!, format: "html", bytes: d.bytes.length, pages, request: { url, sections: sections.length }, httpStatus: d.res.status };
    }),
};

// ---------- DART: the report's XML (the viewer page is a frame set) ----------

/** XML bytes in the encoding their declaration names (DART: UTF-8, older reports EUC-KR). */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const label = /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export const dartDocument: Source = {
  name: "dart-document",
  requiredEnv: ["DART_API_KEY"],
  covers: (s) => registryOf(s) === "dart",
  fetch: (subject, ctx) =>
    outcome(ctx, subject, async (f) => {
      const url = `https://opendart.fss.or.kr/api/document.xml?rcept_no=${f.filingKey}`;
      const d = await download(ctx, `${url}&crtfc_key=${ctx.env.DART_API_KEY}`, {}, url);
      if (!("res" in d)) return d;
      const files = await unzip(d.bytes).catch(() => null);
      if (!files) return { request: { url }, httpStatus: d.res.status, error: `DART ${f.filingKey}: answer is not a zip (${new TextDecoder().decode(d.bytes.slice(0, 200))})` };
      // The main report is <rcept_no>.xml; the others are attachments (audit report...).
      const entries = [...files.entries()].filter(([name]) => /\.xml$/i.test(name));
      const main = entries.find(([name]) => name.replace(/^.*\//, "") === `${f.filingKey}.xml`) ?? entries.sort((a, b) => b[1].length - a[1].length)[0];
      if (!main) return { request: { url }, httpStatus: d.res.status, error: `DART ${f.filingKey}: no XML in the zip` };
      return { documentUrl: url, viewUrl: f.url!, format: "xml", bytes: d.bytes.length, pages: htmlPages(decodeXml(main[1])), request: { url, file: main[0] }, httpStatus: d.res.status };
    }),
};

export const DOCUMENT_SOURCES = [secDocument, pdfDocument, edinetDocument, dartDocument] as const;
