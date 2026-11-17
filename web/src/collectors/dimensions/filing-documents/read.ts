import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { documentPages, documents, type GoldDocument } from "@/db/schema/documents";
import type { Db } from "@/db/types";
import { isPrintedOn } from "./text";

/**
 * The read contract of the stored documents for the judges (PR-D) and the console: the pages where management
 * explains the period, and the check that a quoted sentence is printed on the page it cites.
 */

/**
 * Where a results discussion sits, in each language the registries print: MD&A, results of operations, outlook /
 * guidance, the chairman's statement, 経営成績 / 業績予想, 영업실적 / 사업의 내용. A page scores once per heading found.
 */
export const RESULTS_HEADINGS: readonly RegExp[] = [
  /management['’]s discussion and analysis/i,
  /results of operations/i,
  /\boutlook\b|\bguidance\b/i,
  /chairman['’]s statement|business review|management discussion/i,
  /compared (to|with) the (same|prior|corresponding) (period|quarter|year)/i,
  /\b(increase|decrease)d? (by|of) [\d.,]+ ?(%|percent|per cent)/i,
  /経営成績|業績予想|業績の概況|事業の状況|経営者による/,
  /영업실적|사업의 내용|경영진단|이사의 경영진단/,
];

/** A sentence that explains a change with its size: « revenue grew 9.6% », « margin rose 180 basis points ». */
const CHANGE = /\b(increase[sd]?|decrease[sd]?|grew|grow|rose|fell|declined?|improved?|up|down|higher|lower)\b[^.\n]{0,80}?\d[\d.,]*\s?(%|percent|per cent|basis points|bps)|(増加|減少|増収|減収|増益|減益)|(증가|감소)/gi;

/**
 * A table of contents or a statement table: most lines start or end with a number (page numbers, figures). It lists
 * where the discussion is, it does not explain anything.
 */
export function isListPage(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return false;
  const numbered = lines.filter((l) => /^[\d(]|[\d)]$/.test(l)).length;
  return numbered / lines.length > 0.5;
}

/** How much a page explains the period: one point per results heading, one per sized change (5 at most). */
export function resultsScore(text: string): number {
  if (isListPage(text)) return 0;
  const headings = RESULTS_HEADINGS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  return headings + Math.min(5, (text.match(CHANGE) ?? []).length);
}

export type ResultsPage = { document: GoldDocument; page: number; text: string; score: number };

/**
 * For one ticker and a filing-date window: the pages of its stored documents most likely to explain results, best
 * `perDocument` pages of each document (score, then page order), newest document first.
 */
export async function resultsPages(db: Db, symbol: string, window: { from: Date; to: Date }, perDocument = 3): Promise<ResultsPage[]> {
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.symbol, symbol), gte(documents.filedAt, window.from), lte(documents.filedAt, window.to)))
    .orderBy(desc(documents.filedAt));
  if (docs.length === 0) return [];
  const pages = await db
    .select()
    .from(documentPages)
    .where(inArray(documentPages.documentId, docs.map((d) => d.id)))
    .orderBy(asc(documentPages.page));
  return docs.flatMap((document) =>
    pages
      .filter((p) => p.documentId === document.id)
      .map((p) => ({ document, page: p.page, text: p.text, score: resultsScore(p.text) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score || a.page - b.page)
      .slice(0, perDocument),
  );
}

/** One stored page with its document, or null. */
export async function documentPage(db: Db, documentId: string, page: number): Promise<{ document: GoldDocument; page: number; text: string } | null> {
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) return null;
  const [row] = await db
    .select({ text: documentPages.text })
    .from(documentPages)
    .where(and(eq(documentPages.documentId, documentId), eq(documentPages.page, page)));
  return row ? { document, page, text: row.text } : null;
}

/** True when `quote` is printed on page `page` of the document (whitespace, case, quote and dash styles aside). */
export async function verifyQuote(db: Db, documentId: string, page: number, quote: string): Promise<boolean> {
  const [row] = await db
    .select({ text: documentPages.text })
    .from(documentPages)
    .where(and(eq(documentPages.documentId, documentId), eq(documentPages.page, page)));
  return !!row && isPrintedOn(row.text, quote);
}
