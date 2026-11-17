import { index, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * The text of the company's core documents, page by page (dimension `filing-documents`, right after `filings`):
 * annual / half-year / quarterly reports, results press releases and presentations, 決算短信. One document per filing
 * (silver.filings id), its pages as the registry prints them (a PDF page = page N of the PDF; an HTML filing split on its
 * own page breaks, else in chunks). A claim of the analysis cites `(filing id, page)` and Thierry reads that page, then
 * opens the document itself. Built only from bronze; once a document is stored it is never fetched again.
 */

/** What a document is to an analyst. */
export type DocumentKind = "report" | "results-release" | "presentation";
/** How its text was read: PDF pages, HTML split on page breaks, DART / EDINET XML or HTML sections. */
export type DocumentFormat = "pdf" | "html" | "xml";

/** One row per filing we tried to read: `ok` with its page count, or `failed` with the reason and how many tries. */
export const filingDocuments = silver.table(
  "filing_documents",
  {
    filingId: uuid("filing_id").primaryKey(),
    symbol: text("symbol").notNull(),
    registry: text("registry").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    status: text("status").$type<"ok" | "failed">().notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    /** The file we read (an 8-K's press release exhibit, an EDINET zip...). */
    documentUrl: text("document_url"),
    /** What « Open document » opens: the public file (PDF opens at `#page=N`) or the registry's viewer. */
    viewUrl: text("view_url"),
    format: text("format").$type<DocumentFormat>(),
    pageCount: integer("page_count"),
    chars: integer("chars"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("filing_documents_symbol").on(t.symbol)],
);

/** One row per page of a stored document. Natural key (filing id, page); pages are never rewritten. */
export const filingPages = silver.table(
  "filing_pages",
  {
    filingId: uuid("filing_id").notNull(),
    page: integer("page").notNull(),
    text: text("text").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.filingId, t.page] })],
);

/** The stored documents the console and the judges read: the filing's title and date + where to open it. */
export const documents = gold.table(
  "documents",
  {
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    registry: text("registry").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    form: text("form"),
    title: text("title").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    language: text("language").notNull(),
    viewUrl: text("view_url"),
    format: text("format").$type<DocumentFormat>().notNull(),
    pageCount: integer("page_count").notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_documents_symbol_filed").on(t.symbol, t.filedAt)],
);

export const documentPages = gold.table(
  "document_pages",
  {
    documentId: uuid("document_id").notNull(),
    page: integer("page").notNull(),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.page] })],
);

export type GoldDocument = typeof documents.$inferSelect;
