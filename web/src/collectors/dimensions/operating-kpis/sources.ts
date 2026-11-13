import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import { goldOperatingKpis, type KpiPeriodType, type KpiUnit } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import { isCoreFiling, isViewerPage } from "@/onedrive/rules";
import { BROWSER_HEADERS, SEC_HEADERS } from "../../markets";
import type { FetchOutcome, Source, SourceContext } from "../../types";
import { parsePrinted } from "../financials/sources";

/**
 * Operating KPIs read out of the documents we already collect (gold.filings): the periodic reports of every registry
 * (10-K / 10-Q / 20-F, HKEX annual and interim reports, TDnet 決算短信, EDINET, Companies House accounts) and, for US
 * filers, the earnings release attached to an 8-K "results of operations". Claude copies every operating KPI the
 * company prints; a value is kept only when its figure sits in the passage it quotes and that passage is in the
 * document (`verifyItems`). One read per document and prompt version, reused from the last bronze answer.
 */

export const KPI_EXTRACT_VERSION = "operating-kpis@v1";
export const KPI_SOURCE = "filing-documents";
/** Documents filed in the last 2 years: a year-earlier comparison for every period. */
const YEARS_BACK = 2;
/** The newest documents considered per ticker; reads of older ones stay (up to MAX_KEPT) so the history grows. */
const MAX_DOCUMENTS = 6;
const MAX_KEPT = 16;
/** New documents read per ticker per run: a first run drains over a few runs instead of one long one. */
const MAX_NEW_READS = 2;
/** Text handed to Claude per document, in passages of about CHUNK characters. */
const MAX_CHARS = 60_000;
const CHUNK = 4_000;

/** Node-only modules, hidden from every bundler (a non-literal specifier): the console Worker lists dimensions. */
const nodeImport = (spec: string): Promise<unknown> => import(/* webpackIgnore: true */ spec);

export type KpiDocument = { title: string; url: string; registry: string; form: string | null; filedAt: string };
/** One KPI as Claude copied it, plus our check: `inText` = its figure is in its quote and the quote is in the passage. */
export type KpiItem = {
  kpi: string;
  name: string;
  printed: string;
  unit: string;
  unitLabel?: string | null;
  scale?: string;
  currency?: string | null;
  periodType: string;
  periodEnd: string;
  passage: number;
  quote: string;
  inText?: boolean;
};
export type KpiRead = { version: string; document: KpiDocument; passages: number; items: KpiItem[]; model: string | null; error?: string };
export type KpiPayload = { version: string; reads: KpiRead[] };

/**
 * Words a passage about the business tends to carry, in the languages of our registries. It only picks WHICH passages
 * of a long filing Claude reads (like the statement page titles of `pdf-extract`); Claude then copies every KPI on them.
 */
const OPERATING_WORDS =
  /backlog|order (book|intake|backlog)|orders? (received|booked)|new orders|bookings?|book[- ]to[- ]bill|subscribers?|subscriptions?|customers|members(hip)?|active users|same[- ]store|comparable (store|sales)|like[- ]for[- ]like|utili[sz]ation|occupancy|average daily rate|revpar|annual recurring revenue|\barr\b|recurring revenue|net (revenue|dollar) retention|churn|arpu|average revenue per|units? (sold|shipped|delivered)|shipments|deliveries|volumes?|tonnes|barrels|headcount|number of (stores|locations|clinics|centres|centers|rooms|beds|employees|customers)|contract(s|ed) (value|revenue)|remaining performance obligations?|pipeline|awards|capacity|key (performance )?(indicators|metrics)|operating (metrics|statistics|data)|受注|受注残|販売数量|店舗数|会員数|契約|수주|수주잔고|계약|在手訂單|在手订单|訂單|订单|客戶數|會員|门店|分店/gi;

/** The text of an HTML filing: no script, style or hidden XBRL header; block tags become line breaks. */
export function htmlText(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&mdash;|&#8212;|&ndash;|&#8211;/gi, "-")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Cuts a text into passages of about CHUNK characters, on line breaks. */
export function passagesOf(pages: string[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    let cur = "";
    for (const line of page.split("\n")) {
      if (cur && cur.length + line.length > CHUNK) {
        out.push(cur);
        cur = "";
      }
      cur += (cur ? "\n" : "") + line.slice(0, CHUNK * 2);
    }
    if (cur.trim()) out.push(cur);
  }
  return out;
}

/** The passages Claude reads: the ones that talk about the business most, up to MAX_CHARS, in document order. */
export function pickPassages(passages: string[]): { index: number; text: string }[] {
  const scored = passages
    .map((text, index) => ({ index, text, hits: new Set((text.match(OPERATING_WORDS) ?? []).map((w) => w.toLowerCase())).size }))
    .filter((p) => p.hits > 0 && /\d/.test(p.text))
    .sort((a, b) => b.hits - a.hits || a.index - b.index);
  const picked: { index: number; text: string }[] = [];
  let total = 0;
  for (const p of scored) {
    if (total + p.text.length > MAX_CHARS) continue;
    picked.push({ index: p.index, text: p.text });
    total += p.text.length;
  }
  return picked.sort((a, b) => a.index - b.index);
}

const KPI_SYSTEM = [
  "You read passages of a listed company's filing or earnings release and copy the operating KPIs the company reports. You never compute, estimate, convert or round.",
  "Answer with JSON only, no prose, no code fence.",
].join(" ");

export function kpiPrompt(doc: KpiDocument, passages: { index: number; text: string }[], known: { kpi: string; name: string }[]): string {
  return [
    `Document: ${doc.title} (${doc.registry}${doc.form ? ` ${doc.form}` : ""}, filed ${doc.filedAt.slice(0, 10)}). Each passage starts with its number.`,
    "Copy EVERY operating KPI the company reports about its business: any measure of activity, demand or capacity it chooses to publish (for example backlog or order book, order intake, bookings, book-to-bill, remaining performance obligations, subscribers, customers, same-store sales, utilisation, occupancy, ARR, units shipped, volumes, store count). Whatever the company measures, copy it.",
    "Not a KPI: a line of the income statement, balance sheet or cash flow statement (revenue, profit, cash, debt), a per-share figure, a share count, a market price, and any forecast, guidance or target. Copy actual reported values only.",
    "Copy every period printed: the current one AND the comparative ones (a year earlier, the prior year end).",
    known.length ? `KPIs already read from this company's other documents (reuse the same slug for the same measure): ${known.map((k) => `${k.kpi} (${k.name})`).join("; ")}.` : "",
    'JSON shape: {"kpis": [{"kpi": "<lowercase-hyphen slug of the measure, e.g. backlog, order-intake, subscribers>", "name": "<the measure as the company names it>", "printed": "<the figure exactly as printed, e.g. 1,234.5 or 112% or 2.3x>", "unit": "currency | count | percent | ratio", "unitLabel": "<what a count counts, e.g. subscribers, units, tonnes; null otherwise>", "scale": "one | thousand | million | billion (from the text or column header, e.g. $ in millions = million)", "currency": "<ISO code of a currency figure, else null>", "periodType": "instant (a balance at a date: backlog, subscribers at period end) | quarter | half | year (a flow over the period: bookings)", "periodEnd": "YYYY-MM (the month of the date or of the period end)", "passage": <passage number>, "quote": "<the sentence or table row that prints the figure, copied exactly>"}]}',
    'percent = a percentage (same-store sales +4.2%), ratio = a plain ratio (book-to-bill 1.2). No KPI on these passages: {"kpis": []}.',
    "",
    ...passages.map((p) => `=== Passage ${p.index} ===\n${p.text}`),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

/** Whitespace, quotes and dashes as one form, so a quote copied across a line break still matches. */
const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‒-―−]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();

/** Marks each item `inText`: its printed figure is in its quote, and its quote is in the passage it cites. */
export function verifyItems(items: KpiItem[], passages: Map<number, string>): KpiItem[] {
  return items.map((i) => {
    const passage = passages.get(Number(i.passage));
    const quote = typeof i.quote === "string" ? i.quote : "";
    const printed = typeof i.printed === "string" ? i.printed : "";
    const inText = !!passage && printed.trim() !== "" && quote.trim() !== "" && norm(quote).includes(norm(printed)) && norm(passage).includes(norm(quote));
    return { ...i, inText };
  });
}

const SCALE: Record<string, number> = { one: 1, thousand: 1e3, million: 1e6, billion: 1e9 };
const PERIOD_TYPES = new Set<KpiPeriodType>(["instant", "year", "half", "quarter"]);

export type KpiReading = {
  kpi: string;
  name: string;
  unit: KpiUnit;
  unitLabel: string | null;
  currency: string | null;
  periodType: KpiPeriodType;
  periodEnd: string;
  value: number;
  document: KpiDocument;
  quote: string;
  printed: string;
};

/** The readings a payload holds: only verified items, with a parsable figure, a known unit and period. */
export function kpiReadings(payload: KpiPayload): KpiReading[] {
  const out: KpiReading[] = [];
  for (const read of payload.reads ?? []) {
    for (const i of read.items ?? []) {
      if (!i.inText) continue;
      const slug = String(i.kpi ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const n = parsePrinted(i.printed.replace(/[%x×]\s*$/i, ""));
      const periodType = i.periodType as KpiPeriodType;
      if (!slug || n === null || !PERIOD_TYPES.has(periodType) || !/^\d{4}-\d{2}$/.test(i.periodEnd)) continue;
      const scale = SCALE[i.scale ?? "one"] ?? 1;
      let unit: KpiUnit;
      let value: number;
      if (i.unit === "percent") [unit, value] = ["ratio", n / 100];
      else if (i.unit === "ratio") [unit, value] = ["multiple", n];
      else if (i.unit === "currency") [unit, value] = ["currency", n * scale];
      else [unit, value] = ["count", n * scale];
      out.push({ kpi: slug, name: i.name || slug, unit, unitLabel: i.unitLabel ?? null, currency: unit === "currency" ? (i.currency ?? null) : null, periodType, periodEnd: i.periodEnd, value, document: read.document, quote: i.quote, printed: i.printed });
    }
  }
  return out;
}

/**
 * The documents to read: the newest core filings with a downloadable document, plus a US filer's 8-K earnings
 * releases. DART links a viewer page, ASX an announcement list: neither is the document, both left out.
 */
export async function kpiDocuments(ctx: SourceContext, symbol: string): Promise<KpiDocument[]> {
  if (!ctx.db) return [];
  const since = new Date(Date.now() - YEARS_BACK * 365.25 * 86_400_000);
  const rows = await ctx.db
    .select({ registry: gold.filings.registry, form: gold.filings.form, title: gold.filings.title, url: gold.filings.url, filedAt: gold.filings.filedAt })
    .from(gold.filings)
    .where(and(eq(gold.filings.symbol, symbol), gte(gold.filings.filedAt, since), isNotNull(gold.filings.url)))
    .orderBy(desc(gold.filings.filedAt));
  const isRelease = (r: { registry: string; form: string | null; title: string }) => r.registry === "sec" && r.form === "8-K" && /results of operations/i.test(r.title);
  return rows
    .filter((r) => !isViewerPage(r.registry) && (isCoreFiling(r) || isRelease(r)))
    .slice(0, MAX_DOCUMENTS)
    .map((r) => ({ title: r.title, url: r.url!, registry: r.registry, form: r.form, filedAt: r.filedAt.toISOString() }));
}

/** An 8-K's cover page says little: its earnings release is the EX-99 exhibit of the same filing folder. */
async function secReleaseUrl(ctx: SourceContext, url: string): Promise<string | null> {
  const folder = url.slice(0, url.lastIndexOf("/") + 1);
  const res = await ctx.fetch(`${folder}index.json`, { headers: SEC_HEADERS });
  if (!res.ok) return null;
  const items = ((await res.json()) as { directory?: { item?: { name: string }[] } }).directory?.item ?? [];
  const ex = items.map((i) => i.name).find((n) => /ex-?99/i.test(n) && /\.html?$/i.test(n));
  return ex ? folder + ex : null;
}

/** The document's text, page by page (one page for HTML). */
async function documentPages(ctx: SourceContext, doc: KpiDocument): Promise<string[]> {
  let url = doc.url;
  if (doc.registry === "sec" && doc.form === "8-K") url = (await secReleaseUrl(ctx, url)) ?? url;
  const res = await ctx.fetch(url, { headers: doc.registry === "sec" ? SEC_HEADERS : { ...BROWSER_HEADERS, Accept: "*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("pdf") || /\.pdf$/i.test(url)) {
    const { pdfPages } = (await nodeImport(new URL("../financials/pdf-text.ts", import.meta.url).href)) as typeof import("../financials/pdf-text");
    return pdfPages(new Uint8Array(await res.arrayBuffer()));
  }
  return [htmlText(await res.text())];
}

/** Reads one document: picks its passages about the business, asks Claude, checks every item against the text. */
export async function readDocument(ctx: SourceContext, doc: KpiDocument, known: { kpi: string; name: string }[]): Promise<KpiRead> {
  const picked = pickPassages(passagesOf(await documentPages(ctx, doc)));
  if (picked.length === 0) return { version: KPI_EXTRACT_VERSION, document: doc, passages: 0, items: [], model: null };
  const answer = await ctx.complete!({ system: KPI_SYSTEM, prompt: kpiPrompt(doc, picked, known) });
  const { firstJsonObject } = await import("@/llm/judge");
  const parsed = JSON.parse(firstJsonObject(answer.text)) as { kpis?: KpiItem[] };
  const items = verifyItems(Array.isArray(parsed.kpis) ? parsed.kpis : [], new Map(picked.map((p) => [p.index, p.text])));
  return { version: KPI_EXTRACT_VERSION, document: doc, passages: picked.length, items, model: answer.model };
}

export const filingDocuments: Source = {
  name: KPI_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: 3,
  async fetch(symbol, ctx): Promise<FetchOutcome> {
    if (!ctx.db) return { request: { symbol }, httpStatus: null, error: "no database in this context" };
    const docs = await kpiDocuments(ctx, symbol);
    // One read per document and prompt version: a later run reuses it (one bronze row read, never a history).
    const [prior] = await ctx.db
      .select({ payload: fetches.payload })
      .from(fetches)
      .where(and(eq(fetches.dimension, "operating-kpis"), eq(fetches.source, KPI_SOURCE), eq(fetches.subject, symbol), isNull(fetches.error)))
      .orderBy(desc(fetches.fetchedAt))
      .limit(1);
    const previous = ((prior?.payload as KpiPayload | undefined)?.reads ?? []).filter((r) => r.version === KPI_EXTRACT_VERSION);
    if (docs.length === 0 && previous.length === 0) return { request: { symbol }, httpStatus: null, error: "no filing document to read among the collected filings (none, or the registry links a viewer page)" };
    const known = await ctx.db.selectDistinct({ kpi: goldOperatingKpis.kpi, name: goldOperatingKpis.name }).from(goldOperatingKpis).where(eq(goldOperatingKpis.symbol, symbol));
    const reads: KpiRead[] = [];
    const reused: string[] = [];
    const read: string[] = [];
    const waiting: string[] = [];
    const failed: string[] = [];
    for (const doc of docs) {
      const same = previous.find((r) => r.document.url === doc.url && !r.error);
      if (same) {
        reads.push(same);
        reused.push(doc.url);
        continue;
      }
      if (read.length + failed.length >= MAX_NEW_READS) {
        waiting.push(doc.url);
        continue;
      }
      if (!ctx.complete) return { request: { symbol }, httpStatus: null, error: "no LLM in this context" };
      try {
        const r = await readDocument(ctx, doc, [...known, ...reads.flatMap((x) => x.items.filter((i) => i.inText).map((i) => ({ kpi: i.kpi, name: i.name })))]);
        reads.push(r);
        read.push(doc.url);
      } catch (err) {
        failed.push(`${doc.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Older documents out of the window keep their reads: the KPI history grows past the last 6 filings.
    for (const r of previous) if (!reads.some((x) => x.document.url === r.document.url) && !r.error) reads.push(r);
    const kept = reads.sort((a, b) => b.document.filedAt.localeCompare(a.document.filedAt)).slice(0, MAX_KEPT);
    const payload: KpiPayload = { version: KPI_EXTRACT_VERSION, reads: kept };
    return {
      request: { symbol, documents: docs.map((d) => `${d.form ?? d.registry} ${d.filedAt.slice(0, 10)} ${d.url}`), read, reused, waiting, version: KPI_EXTRACT_VERSION },
      httpStatus: 200,
      payload,
      // A failed read leaves the others in the payload; the run still says which document failed.
      ...(failed.length && kept.length === 0 ? { error: `every document read failed; first: ${failed[0]}` } : {}),
      ...(failed.length && kept.length > 0 ? { payloadText: `failed: ${failed.join("; ")}` } : {}),
    };
  },
};
