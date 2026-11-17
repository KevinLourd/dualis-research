import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { documents, filingDocuments, filingPages } from "@/db/schema/documents";
import { filings } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { DOCUMENT_SOURCES, documentKind, parseSubject, subjectOf, type DocumentPayload } from "./sources";

/**
 * filing-documents (right after `filings`): the text of each analysed company's core documents, page by page, so a
 * claim can cite the page it rests on and Thierry can read it (`doc:` item panel), then open the document there.
 * Newest first, a few per ticker per run so the first runs stay short; a stored document is never fetched again, a
 * failed one is tried again up to `MAX_ATTEMPTS` times. No summary here: the judges read the pages.
 */

export const FILING_DOCUMENTS_DIMENSION = "filing-documents";
export const YEARS = 5;
/** Documents per ticker per run: the 5-year backlog drains over a few days without a long run. */
export const MAX_PER_TICKER = 6;
/** Documents per run, all tickers together (each one's newest first). */
export const MAX_PER_RUN = 120;
export const MAX_ATTEMPTS = 3;
/**
 * TDnet serves a release's PDF about a month (then 404, measured 2026-11-18 on Miraial: every PDF older than ~2 months
 * gone). An older one is never asked: it would spend the ticker's budget on a sure 404 ahead of its EDINET reports.
 */
export const TDNET_KEEP_DAYS = 31;

/** The filings still to read: newest first per analysed ticker, interleaved so every ticker gets its latest. */
export async function documentSubjects(db: Db, now = new Date()): Promise<string[]> {
  const symbols = await analysedSymbols(db);
  if (symbols.length === 0) return [];
  const since = new Date(now.getTime() - YEARS * 365.25 * 86_400_000);
  const tdnetSince = now.getTime() - TDNET_KEEP_DAYS * 86_400_000;
  const rows = await db
    .select({ id: filings.id, symbol: filings.symbol, registry: filings.registry, form: filings.form, title: filings.title, filedAt: filings.filedAt, status: filingDocuments.status, attempts: filingDocuments.attempts })
    .from(filings)
    .leftJoin(filingDocuments, eq(filingDocuments.filingId, filings.id))
    .where(and(inArray(filings.symbol, symbols), gte(filings.filedAt, since), isNotNull(filings.url)))
    .orderBy(desc(filings.filedAt));
  const served = (r: (typeof rows)[number]) => r.registry !== "tdnet" || r.filedAt.getTime() >= tdnetSince;
  const todo = rows.filter((r) => documentKind(r) && served(r) && (r.status === null || (r.status === "failed" && (r.attempts ?? 0) < MAX_ATTEMPTS)));
  const perTicker = new Map<string, typeof todo>();
  for (const r of todo) {
    const list = perTicker.get(r.symbol) ?? [];
    if (list.length < MAX_PER_TICKER) perTicker.set(r.symbol, [...list, r]);
  }
  const out: string[] = [];
  for (let rank = 0; rank < MAX_PER_TICKER; rank++) for (const list of perTicker.values()) if (list[rank]) out.push(subjectOf(list[rank]));
  return out.slice(0, MAX_PER_RUN);
}

export const filingDocumentsDim: Dimension = {
  name: FILING_DOCUMENTS_DIMENSION,
  description: "The text of each company's reports, results releases and presentations, page by page, so every claim cites its page.",
  sources: DOCUMENT_SOURCES,
  subjects: (db) => documentSubjects(db),
  promote: promoteDocuments,
};

const PAGE_BATCH = 200;

/** bronze -> silver.filing_documents (ok or failed + why) and silver.filing_pages -> gold.documents + gold.document_pages. */
export async function promoteDocuments(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const mine = fetches.filter((f) => f.dimension === FILING_DOCUMENTS_DIMENSION);
  const ids = [...new Set(mine.map((f) => parseSubject(f.subject).filingId))];
  if (ids.length === 0) return { silverRowsBySource: {} };
  const known = new Map((await db.select().from(filings).where(inArray(filings.id, ids))).map((f) => [f.id, f]));
  const silverRowsBySource: Record<string, number> = {};
  const stored: string[] = [];
  for (const f of mine) {
    const { filingId, symbol, registry } = parseSubject(f.subject);
    const filing = known.get(filingId);
    if (!filing) continue;
    const kind = documentKind(filing) ?? "report";
    const p = f.error ? null : (f.payload as DocumentPayload | null);
    if (!p?.pages) {
      // A failure keeps its reason and counts a try; a document already stored stays stored. A document the registry
      // no longer serves (TDnet keeps a PDF about a month: 404) is never asked again.
      const error = f.error ?? "no pages in the answer";
      const gone = /HTTP (404|410)\b/.test(error);
      await db
        .insert(filingDocuments)
        .values({ filingId, symbol, registry, kind, status: "failed", error, attempts: gone ? MAX_ATTEMPTS : 1, sources: [f.source], bronzeIds: [f.id], fetchedAt: f.fetchedAt })
        .onConflictDoUpdate({
          target: filingDocuments.filingId,
          set: {
            error: sql`excluded.error`,
            attempts: sql`greatest(${filingDocuments.attempts} + 1, excluded.attempts)`,
            bronzeIds: sql`${filingDocuments.bronzeIds} || excluded.bronze_ids`,
            fetchedAt: sql`excluded.fetched_at`,
          },
          setWhere: sql`${filingDocuments.status} <> 'ok'`,
        });
      continue;
    }
    const chars = p.pages.reduce((n, t) => n + t.length, 0);
    await db
      .insert(filingDocuments)
      .values({ filingId, symbol, registry, kind, status: "ok", error: null, documentUrl: p.documentUrl, viewUrl: p.viewUrl, format: p.format, pageCount: p.pages.length, chars, sources: [f.source], bronzeIds: [f.id], fetchedAt: f.fetchedAt })
      .onConflictDoUpdate({
        target: filingDocuments.filingId,
        set: {
          status: "ok",
          error: null,
          attempts: sql`${filingDocuments.attempts} + 1`,
          documentUrl: p.documentUrl,
          viewUrl: p.viewUrl,
          format: p.format,
          pageCount: p.pages.length,
          chars,
          sources: [f.source],
          bronzeIds: sql`${filingDocuments.bronzeIds} || excluded.bronze_ids`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`${filingDocuments.status} <> 'ok'`,
      });
    const rows = p.pages.map((text, i) => ({ filingId, page: i + 1, text, sources: [f.source], bronzeIds: [f.id] }));
    for (let i = 0; i < rows.length; i += PAGE_BATCH) await db.insert(filingPages).values(rows.slice(i, i + PAGE_BATCH)).onConflictDoNothing();
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + 1;
    stored.push(filingId);
  }
  await rebuildGoldDocuments(db, [...new Set(mine.map((f) => parseSubject(f.subject).symbol))], stored);
  return { silverRowsBySource };
}

/** gold.documents for these tickers (every stored document, its filing's title and date); new pages copied once. */
export async function rebuildGoldDocuments(db: Db, symbols: string[], newDocumentIds: string[]): Promise<void> {
  if (symbols.length === 0) return;
  await db.delete(documents).where(inArray(documents.symbol, symbols));
  await db.execute(sql`
    INSERT INTO gold.documents (id, symbol, registry, kind, form, title, filed_at, language, view_url, format, page_count, sources)
    SELECT filings.id, filings.symbol, filings.registry, filing_documents.kind, filings.form, filings.title, filings.filed_at,
      filings.language, filing_documents.view_url, filing_documents.format, filing_documents.page_count, ARRAY[filings.registry]
    FROM silver.filing_documents JOIN silver.filings ON filings.id = filing_documents.filing_id
    WHERE filing_documents.status = 'ok' AND ${inArray(filingDocuments.symbol, symbols)}`);
  if (newDocumentIds.length === 0) return;
  await db.execute(sql`
    INSERT INTO gold.document_pages (document_id, page, text)
    SELECT filing_id, page, text FROM silver.filing_pages WHERE ${inArray(filingPages.filingId, newDocumentIds)}
    ON CONFLICT DO NOTHING`);
}

