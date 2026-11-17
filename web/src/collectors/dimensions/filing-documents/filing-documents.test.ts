import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { documentPages, documents, filingDocuments, filingPages } from "@/db/schema/documents";
import { filings } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { DocumentPageText, docItemId, openAt, parseDocItem } from "@/console/document-page";
import { runDimension } from "../../runner";
import type { SourceContext } from "../../types";
import { watchlist } from "../watchlist";
import { documentSubjects, filingDocumentsDim } from ".";
import { resultsPages, verifyQuote } from "./read";
import { documentKind, secExhibits } from "./sources";
import { chunk, findQuote, htmlPages, isPrintedOn } from "./text";

/** A real two-page PDF (Helvetica text), offsets computed so pdf.js reads it without repair. */
function pdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const lines = text.split("\n").map((l, j) => `BT /F1 10 Tf 40 ${780 - j * 14} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const ANNUAL_PDF = pdf([
  "Water Oasis Group Limited\nAnnual Report 2026",
  "Management Discussion and Analysis\nRevenue from services grew 9.6% compared with the same period last year,\nas new beauty centres opened in Kowloon.\nOutlook: the Group expects demand to stay firm.",
]);

const TEN_Q = `<html><body><div><p>Monro, Inc. Form 10-Q</p></div><hr style="page-break-after:always"/>
<div><p>Item 2. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations</p>
<p>Sales decreased 4.1% compared to the prior year period, driven by lower tire units.</p></div>
<div style="page-break-before: always"></div><div><p>Item 4. Controls and Procedures</p></div></body></html>`;

const EIGHT_K_INDEX = `<table class="tableFile" summary="Document Format Files">
<tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/876427/000087642726000010/mnro-8k.htm">mnro-8k.htm</a></td><td scope="row">8-K</td><td>100</td></tr>
<tr><td scope="row">2</td><td scope="row">EX-99.1</td><td scope="row"><a href="/Archives/edgar/data/876427/000087642726000010/pressrelease.htm">pressrelease.htm</a></td><td scope="row">EX-99.1</td><td>900</td></tr>
</table>`;
const PRESS_RELEASE = `<html><body><p>Monro, Inc. Reports Second Quarter Fiscal 2027 Results</p><p>Comparable store sales increased 2.0% as the Company closed underperforming stores.</p><p>Gross margin rose 180 basis points on lower material costs and a better mix of services, the Company said in its outlook.</p></body></html>`;

const calls: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  const ok = (body: BodyInit, type: string) => new Response(body, { status: 200, headers: { "content-type": type } });
  if (url === "https://www1.hkexnews.hk/ar2026.pdf") return ok(new Blob([ANNUAL_PDF as Uint8Array<ArrayBuffer>]), "application/pdf");
  if (url.endsWith("/mnro-10q.htm")) return ok(TEN_Q, "text/html");
  if (url.endsWith("/0000876427-26-000010-index.html")) return ok(EIGHT_K_INDEX, "text/html");
  if (url.endsWith("/pressrelease.htm")) return ok(PRESS_RELEASE, "text/html");
  if (url === "https://www1.hkexnews.hk/gone.pdf") return new Response("busy", { status: 503 });
  if (url === "https://www1.hkexnews.hk/expired.pdf") return new Response("not found", { status: 404 });
  throw new Error(`unexpected url ${url}`);
}) as typeof fetch;

const ctx: SourceContext = { env: { REPO_ROOT: resolve(__dirname, "../../../../..") }, fetch: fakeFetch };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  calls.length = 0;
  await runDimension(db, watchlist, { trigger: "test", ctx });
  await analyseEveryTicker(db);
});
afterEach(async () => close());

const day = (d: string) => new Date(`${d}T08:00:00Z`);
async function seedFilings() {
  const rows = [
    { symbol: "1161.HK", registry: "hkex", filingKey: "hk-ar", form: "Annual Report", title: "Annual Report 2026", filedAt: day("2026-07-20"), url: "https://www1.hkexnews.hk/ar2026.pdf" },
    { symbol: "1161.HK", registry: "hkex", filingKey: "hk-gone", form: "Interim Report", title: "Interim Report 2026", filedAt: day("2026-06-01"), url: "https://www1.hkexnews.hk/gone.pdf" },
    { symbol: "1161.HK", registry: "hkex", filingKey: "hk-expired", form: "Annual Report", title: "Annual Report 2024", filedAt: day("2025-07-20"), url: "https://www1.hkexnews.hk/expired.pdf" },
    { symbol: "1161.HK", registry: "hkex", filingKey: "hk-poll", form: null, title: "Poll Results of the Annual General Meeting", filedAt: day("2026-08-01"), url: "https://www1.hkexnews.hk/poll.pdf" },
    { symbol: "MNRO", registry: "sec", filingKey: "0000876427-26-000011", form: "10-Q", title: "Quarterly report", filedAt: day("2026-11-01"), url: "https://www.sec.gov/Archives/edgar/data/876427/000087642726000011/mnro-10q.htm" },
    { symbol: "MNRO", registry: "sec", filingKey: "0000876427-26-000010", form: "8-K", title: "Current report: results of operations", filedAt: day("2026-10-29"), url: "https://www.sec.gov/Archives/edgar/data/876427/000087642726000010/mnro-8k.htm" },
    { symbol: "MNRO", registry: "sec", filingKey: "0000876427-26-000009", form: "4", title: "Insider transaction", filedAt: day("2026-10-28"), url: "https://www.sec.gov/x/form4.xml" },
  ];
  const inserted = await db
    .insert(filings)
    .values(rows.map((r) => ({ ...r, language: "en", sources: [r.registry], bronzeIds: [] })))
    .returning();
  return Object.fromEntries(inserted.map((r) => [r.filingKey, r.id]));
}

describe("filing-documents dimension", () => {
  it("reads core documents into pages (PDF, 10-Q page breaks, 8-K press release), never fetches one twice", async () => {
    const id = await seedFilings();
    const report = await runDimension(db, filingDocumentsDim, { trigger: "test", ctx });
    expect(report.error).toBeNull();

    const docs = await db.select().from(filingDocuments);
    const ok = docs.filter((d) => d.status === "ok");
    expect(ok.map((d) => d.filingId).sort()).toEqual([id["hk-ar"], id["0000876427-26-000011"], id["0000876427-26-000010"]].sort());
    // The poll result and the Form 4 are not documents we read.
    expect(docs.map((d) => d.filingId)).not.toContain(id["hk-poll"]);
    expect(docs.map((d) => d.filingId)).not.toContain(id["0000876427-26-000009"]);

    const failed = docs.find((d) => d.filingId === id["hk-gone"])!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.error).toContain("HTTP 503");
    // A document the registry no longer serves is never asked again.
    expect(docs.find((d) => d.filingId === id["hk-expired"])).toMatchObject({ status: "failed", attempts: 3 });

    // PDF: one page per PDF page, numbers as printed.
    const ar = await db.select().from(filingPages).where(eq(filingPages.filingId, id["hk-ar"]));
    expect(ar.map((p) => p.page).sort()).toEqual([1, 2]);
    expect(ar.find((p) => p.page === 2)!.text).toContain("Revenue from services grew 9.6%");
    expect(ok.find((d) => d.filingId === id["hk-ar"])).toMatchObject({ format: "pdf", pageCount: 2, viewUrl: "https://www1.hkexnews.hk/ar2026.pdf", kind: "report" });

    // 10-Q: split on its own page breaks.
    const q = await db.select().from(filingPages).where(eq(filingPages.filingId, id["0000876427-26-000011"]));
    expect(q).toHaveLength(3);
    expect(q.find((p) => p.page === 2)!.text).toContain("Management’s Discussion and Analysis");

    // 8-K: the press release exhibit, not the cover page.
    const pr = ok.find((d) => d.filingId === id["0000876427-26-000010"])!;
    expect(pr).toMatchObject({ kind: "results-release", viewUrl: "https://www.sec.gov/Archives/edgar/data/876427/000087642726000010/pressrelease.htm" });

    // Gold: the documents with their filing's title and date, and their pages.
    const gold = await db.select().from(documents);
    expect(gold).toHaveLength(3);
    expect(gold.find((d) => d.id === id["hk-ar"])).toMatchObject({ title: "Annual Report 2026", symbol: "1161.HK", sources: ["hkex"] });
    expect((await db.select().from(documentPages)).length).toBe(2 + 3 + 1);

    // A second run fetches nothing stored again; the failed one is tried again and counts its try.
    const bronzeBefore = (await db.select().from(fetches).where(eq(fetches.dimension, "filing-documents"))).length;
    calls.length = 0;
    expect(await documentSubjects(db)).toEqual([`1161.HK|hkex|${id["hk-gone"]}`]);
    await runDimension(db, filingDocumentsDim, { trigger: "test", ctx });
    expect(calls).toEqual(["https://www1.hkexnews.hk/gone.pdf"]);
    expect((await db.select().from(fetches).where(eq(fetches.dimension, "filing-documents"))).length).toBe(bronzeBefore + 1);
    const [retried] = await db.select().from(filingDocuments).where(eq(filingDocuments.filingId, id["hk-gone"]));
    expect(retried.attempts).toBe(2);
    expect((await db.select().from(documentPages)).length).toBe(6);
  });

  it("verifyQuote: true for a sentence printed on the page, false for an invented one or another page", async () => {
    const id = await seedFilings();
    await runDimension(db, filingDocumentsDim, { trigger: "test", ctx });
    // PDF text breaks lines anywhere: the quote crosses one.
    expect(await verifyQuote(db, id["hk-ar"], 2, "Revenue from services grew 9.6% compared with the same period last year, as new beauty centres opened")).toBe(true);
    expect(await verifyQuote(db, id["hk-ar"], 2, "Revenue from services grew 19.6% on strong demand")).toBe(false);
    expect(await verifyQuote(db, id["hk-ar"], 1, "Revenue from services grew 9.6%")).toBe(false);
    expect(await verifyQuote(db, id["0000876427-26-000011"], 2, "Sales decreased 4.1% compared to the prior year period")).toBe(true);
  });

  it("resultsPages: the pages where management explains the period, in the window", async () => {
    const id = await seedFilings();
    await runDimension(db, filingDocumentsDim, { trigger: "test", ctx });
    const pages = await resultsPages(db, "1161.HK", { from: day("2026-01-01"), to: day("2026-12-31") });
    expect(pages.map((p) => [p.document.id, p.page])).toEqual([[id["hk-ar"], 2]]);
    const mnro = await resultsPages(db, "MNRO", { from: day("2026-10-30"), to: day("2026-12-31") });
    expect(mnro.map((p) => p.page)).toEqual([2]);
    expect(await resultsPages(db, "MNRO", { from: day("2025-01-01"), to: day("2025-12-31") })).toEqual([]);
  });
});

describe("document rules and text", () => {
  it("documentKind: reports, results releases and presentations only", () => {
    expect(documentKind({ registry: "sec", form: "10-K", title: "Annual report" })).toBe("report");
    expect(documentKind({ registry: "sec", form: "8-K", title: "Current report: results of operations" })).toBe("results-release");
    expect(documentKind({ registry: "sec", form: "8-K", title: "Current report: officer or director change" })).toBeNull();
    expect(documentKind({ registry: "tdnet", form: null, title: "2027年３月期 第２四半期(中間期)決算短信〔日本基準〕(連結)" })).toBe("report");
    expect(documentKind({ registry: "tdnet", form: null, title: "2027年３月期 第２四半期 決算説明資料" })).toBe("presentation");
    expect(documentKind({ registry: "hkex", form: null, title: "Interim Results Announcement for the Six Months Ended 31 March 2026" })).toBe("results-release");
    expect(documentKind({ registry: "dart", form: null, title: "분기보고서 (2026.09)" })).toBe("report");
  });

  it("reads an EDGAR index's exhibits", () => {
    expect(secExhibits(EIGHT_K_INDEX)).toEqual([
      { type: "8-K", url: "https://www.sec.gov/Archives/edgar/data/876427/000087642726000010/mnro-8k.htm" },
      { type: "EX-99.1", url: "https://www.sec.gov/Archives/edgar/data/876427/000087642726000010/pressrelease.htm" },
    ]);
  });

  it("cuts a page-break-free document in chunks at a paragraph, drops scripts and NUL", () => {
    const html = `<script>var x=1</script>${Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i} ${"word ".repeat(40)}</p>`).join("")}\u0000`;
    const pages = htmlPages(html);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.length <= 4000 && !p.includes("var x") && !p.includes("\u0000"))).toBe(true);
    expect(chunk("a ".repeat(10), 8).every((c) => c.length <= 8)).toBe(true);
  });

  it("isPrintedOn / findQuote ignore whitespace, case and quote styles, never a short quote", () => {
    const page = "Sales decreased 4.1%\ncompared to the prior “year” period.";
    expect(isPrintedOn(page, "sales decreased 4.1% compared to the prior \"year\" period")).toBe(true);
    expect(isPrintedOn(page, "4.1%")).toBe(false);
    const at = findQuote(page, "4.1% compared to the prior")!;
    expect(page.slice(at[0], at[1])).toBe("4.1%\ncompared to the prior");
    expect(findQuote(page, "an invented sentence here")).toBeNull();
  });
});

describe("doc: item panel", () => {
  it("parses its id and renders the page with the quote highlighted, or says the quote is not there", () => {
    const docId = "0b7c2a6e-1f1d-4a54-9f50-0e1d2c3b4a59";
    expect(parseDocItem(`${docId}:2:Revenue: from services`)).toEqual({ documentId: docId, page: 2, quote: "Revenue: from services" });
    expect(parseDocItem(`${docId}:0`)).toBeNull();
    expect(docItemId(docId, 3)).toBe(`doc:${docId}:3`);
    expect(openAt("https://x/ar.pdf", "pdf", 7)).toBe("https://x/ar.pdf#page=7");
    expect(openAt("https://x/10q.htm", "html", 7)).toBe("https://x/10q.htm");

    const text = "Management Discussion and Analysis\nRevenue from services grew 9.6% compared with the same period last year.";
    const html = renderToStaticMarkup(createElement(DocumentPageText, { text, quote: "Revenue from services grew 9.6%" }));
    expect(html).toContain("<mark");
    expect(html).toMatch(/<mark[^>]*>Revenue from services grew 9\.6%<\/mark>/);
    const missing = renderToStaticMarkup(createElement(DocumentPageText, { text, quote: "Revenue doubled in the period" }));
    expect(missing).not.toContain("<mark");
    expect(missing).toContain("not printed on this page");
  });
});
