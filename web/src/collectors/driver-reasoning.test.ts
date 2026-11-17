import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fairValues, narrativeDrivers, narratives, narrativeStates, priceMoveCauses, priceMoves, type AnalysisAnswer, type GoldNarrativeState } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import { documentPages, documents } from "@/db/schema/documents";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { movesText } from "./dimensions/analysis/facts";
import { analysisPrompt, bindMoves, parseAnalysis } from "./dimensions/analysis/prompt";
import { dbStore, judgeThesis, keepPrintedCitations, memoryStore, pagesToRead, parseAnswer, promoteNarrativeStates } from "./dimensions/narrative-state";

// The console Link needs the Next router; a plain anchor renders the same href.
vi.mock("@/console/link", () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => createElement("a", { href, className }, children) }));

const SYMBOL = "4238.T";
const DOC = "6f1d1a52-7777-4a3b-9c1d-000000000001";
const PAGE_TEXT = "Results of operations\nOrders for 300mm wafer shippers doubled as two customers signed multi-year supply agreements.\nNet sales increased by 18.2% compared with the same period last year.";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
});
afterEach(async () => close());

async function seedDocument(filedAt = new Date()) {
  await db.insert(documents).values({ id: DOC, symbol: SYMBOL, registry: "tdnet", kind: "results-release", form: null, title: "Summary of results, first half FY2026", filedAt, language: "en", viewUrl: "https://example.com/r.pdf", format: "pdf", pageCount: 3, sources: ["tdnet"] });
  await db.insert(documentPages).values([
    { documentId: DOC, page: 1, text: "Contents\n1\n2\n3" },
    { documentId: DOC, page: 2, text: PAGE_TEXT },
  ]);
}

async function seedMoves() {
  const move = (day: string, z: number, kind: "fundamental" | "macro", fact: string) => ({ m: { id: `${SYMBOL}:${day}`, symbol: SYMBOL, startDay: day, endDay: day, days: 1, currency: "JPY", closeBefore: 1000, closeEnd: 1200, returnPct: 0.2, benchReturn: 0.01, abnormal: 0.19, z, beta: 1, direction: "up" as const }, c: { id: `${SYMBOL}:${day}`, symbol: SYMBOL, kind, fact, category: kind === "fundamental" ? ("Business economics" as const) : null, cites: [], candidates: 1, confidence: 0.8, judgmentId: null } });
  const rows = [move("2026-06-01", 5.1, "fundamental", "First-half orders doubled on two multi-year contracts."), move("2026-03-10", 3, "macro", "The Nikkei fell on rate fears.")];
  await db.insert(priceMoves).values(rows.map((r) => r.m));
  await db.insert(priceMoveCauses).values(rows.map((r) => r.c));
}

describe("drivers rest on the moves the market made on the business (INFLECTION-1117)", () => {
  it("the analysis reads the business moves only, with the id a driver cites; an unknown move id is dropped", async () => {
    await seedMoves();
    const m = await movesText(db, SYMBOL, new Date("2026-11-17T00:00:00Z"));
    expect(m.text).toContain("[move 2026-06-01]");
    expect(m.text).toContain("First-half orders doubled");
    expect(m.text).not.toContain("Nikkei");
    expect(m.text).toContain("Also 1 significant move caused by the market at large or by trading");
    expect([...m.ids]).toEqual([`${SYMBOL}:2026-06-01`]);
    // The game is explained, and leverage is read against earnings, never the market cap.
    const prompt = analysisPrompt(m.text!, "short");
    expect(prompt).toContain("a driver is what the market reacted to on the BUSINESS");
    expect(prompt).toContain("never because it is large against the market cap");

    const answer: AnalysisAnswer = parseAnalysis(JSON.stringify({ narrative: "The market sees Miraial as a recovering wafer-carrier maker.", drivers: [{ category: "Business economics", title: "Orders doubled on multi-year contracts", text: "Orders doubled.", exhibits: [], moves: ["2026-06-01", "[move 2026-03-10]", "2020-01-01"] }] }));
    expect(bindMoves(answer, SYMBOL, m.ids).drivers[0].moveIds).toEqual([`${SYMBOL}:2026-06-01`]);
  });
});

describe("Driver State v5: Structural / Temporary, magnitude, the reason, quotes checked on their page", () => {
  it("parses durability, magnitude, reason, explanation and citations; nothing turns = n-a", () => {
    const a = parseAnswer(JSON.stringify({ tag: "reversal:strong", p: 0.8, durability: "structural", magnitude: { figure: "Orders", from: "JPY 4.1B, 1H FY2025", to: "JPY 8.3B, 1H FY2026", change: "+102%", size: "material" }, reason: "Orders doubled on two multi-year contracts: structural.", explanation: "Management says orders doubled.", citations: [{ doc: "D1", page: 2, quote: "Orders for 300mm wafer shippers doubled" }, { doc: "D1", page: "x", quote: "bad page" }] }), false);
    expect(a).toMatchObject({ durability: "structural", magnitude: { figure: "Orders", change: "+102%", size: "material" }, reason: "Orders doubled on two multi-year contracts: structural.", citations: [{ doc: "D1", page: 2, quote: "Orders for 300mm wafer shippers doubled" }] });
    expect(parseAnswer(JSON.stringify({ tag: "noise", p: 0.5, durability: "structural" }), false).durability).toBe("n-a");
  });

  it("drops a citation whose quote is not printed on its page, or whose document the judge was not shown", async () => {
    await seedDocument();
    const pages = await pagesToRead(db, SYMBOL);
    // The table of contents is no results page; page 2 is.
    expect(pages.map((p) => [p.label, p.page.page])).toEqual([["D1", 2]]);
    const kept = await keepPrintedCitations(db, [{ doc: "D1", page: 2, quote: "Orders for 300mm wafer shippers doubled" }, { doc: "D1", page: 2, quote: "Orders tripled on a new fab" }, { doc: "D9", page: 2, quote: "Orders for 300mm wafer shippers doubled" }], pages);
    expect(kept).toEqual([{ documentId: DOC, page: 2, quote: "Orders for 300mm wafer shippers doubled", title: "Summary of results, first half FY2026", filedAt: expect.any(String) }]);
  });

  it("the driver judge reads its moves and the documents; the thesis judge reads durability and size; gold keeps the reason", async () => {
    await seedDocument();
    await seedMoves();
    await db.insert(gold.quotes).values({ symbol: SYMBOL, date: "2026-11-14", close: 2500, currency: "JPY", sources: ["yahoo"] });
    await db.insert(fairValues).values({ symbol: SYMBOL, value: 2000, currency: "JPY", low: 1800, high: 2200, method: "x", label: "x", author: "claude", claudeValue: 2000, inputs: [] });
    await db.insert(narratives).values({ id: `${SYMBOL}:short`, symbol: SYMBOL, side: "short", text: "The market sees Miraial as a recovering wafer-carrier maker.", detail: null, version: "v1", asOf: new Date() });
    await db.insert(narrativeDrivers).values({ id: `${SYMBOL}:short:1`, symbol: SYMBOL, side: "short", rank: 1, category: "Business economics", title: "Orders doubled on multi-year contracts", summary: null, text: "Orders doubled.", moveIds: [`${SYMBOL}:2026-06-01`], version: "v1" });
    const prompts: { driver?: string; thesis?: string } = {};
    let n = 0;
    const fake: Complete = async ({ prompt }) => {
      n++;
      if (prompt.includes("Where does this reason stand NOW")) {
        prompts.driver = prompt;
        return { text: JSON.stringify({ tag: "reversal:weak", p: 0.7, durability: "temporary", magnitude: { figure: "Orders", from: "JPY 4.1B", to: "JPY 8.3B", change: "+102%", size: "material" }, since: "2026-11-10", pricedIn: "none", headline: "Orders double, one-off", reason: "Orders doubled on a one-off restocking: temporary.", explanation: "Management: Orders for 300mm wafer shippers doubled as two customers signed. The restocking ends next year.", citations: [{ doc: "D1", page: 2, quote: "Orders for 300mm wafer shippers doubled" }, { doc: "D1", page: 2, quote: "Invented sentence nobody printed" }], why: "A restocking." }), model: "fake" };
      }
      prompts.thesis = prompt;
      return { text: JSON.stringify({ tag: "reversal:weak", p: 0.6, signal: "weak", since: "2026-11-10", pricedIn: "none", why: "A temporary turn." }), model: "fake" };
    };
    const d = { side: "short" as const, version: "v1", narrative: "The market sees Miraial as a recovering wafer-carrier maker.", market: null, drivers: [{ id: `${SYMBOL}:short:1`, rank: 1, category: "Business economics", title: "Orders doubled on multi-year contracts", text: "Orders doubled.", moveIds: [`${SYMBOL}:2026-06-01`] }] };
    const payload = await judgeThesis(db, fake, dbStore(db), SYMBOL, d);
    expect(prompts.driver).toContain("First-half orders doubled on two multi-year contracts.");
    expect(prompts.driver).toContain("[D1 page 2] Summary of results, first half FY2026");
    expect(prompts.driver).toContain("strong needs a structural change AND a material one");
    expect(prompts.thesis).toContain("reversal:weak, temporary, Orders JPY 4.1B to JPY 8.3B (+102%), material");
    expect(prompts.thesis).toContain("Orders doubled on a one-off restocking: temporary.");
    // The invented quote is dropped, never retried.
    expect(payload.drivers[0].citations).toEqual([expect.objectContaining({ documentId: DOC, page: 2, quote: "Orders for 300mm wafer shippers doubled" })]);
    expect(n).toBe(2);
    // Same input: never asked again.
    await judgeThesis(db, fake, dbStore(db), SYMBOL, d);
    expect(n).toBe(2);
    // A dry replay never writes: a memory store asks again.
    await judgeThesis(db, fake, memoryStore(), SYMBOL, d);
    expect(n).toBe(4);

    await promoteNarrativeStates(db, [{ subject: `${SYMBOL}:short`, payload, error: null, fetchedAt: new Date() } as unknown as BronzeFetch]);
    const states = await db.select().from(narrativeStates);
    expect(states.find((s) => s.level === "driver")).toMatchObject({ durability: "temporary", reason: "Orders doubled on a one-off restocking: temporary.", magnitude: { figure: "Orders", size: "material" }, citations: [expect.objectContaining({ page: 2 })] });
  });
});

describe("the driver panel: the reason first, then what changed with its quotes, then the moves", () => {
  it("renders in that order, each quote a chip opening its page, each move opening its panel", async () => {
    const { DriverReason } = await import("@/console/driver-reason");
    const state = { effect: "reversal", strength: "weak", why: "A restocking.", reason: "Orders doubled on a one-off restocking: temporary.", durability: "temporary", magnitude: { figure: "Orders", from: "JPY 4.1B", to: "JPY 8.3B", change: "+102%", size: "material" }, explanation: "Management: Orders for 300mm wafer shippers doubled as two customers signed. It ends next year.", citations: [{ documentId: DOC, page: 2, quote: "Orders for 300mm wafer shippers doubled", title: "Summary of results" }] } as unknown as GoldNarrativeState;
    const moves = [{ id: `${SYMBOL}:2026-06-01`, startDay: "2026-06-01", direction: "up", returnPct: 0.2, cause: { fact: "First-half orders doubled." } }] as never;
    const html = renderToStaticMarkup(createElement(DriverReason, { state, side: "short", moves, hrefFor: (item: string) => `/x?item=${encodeURIComponent(item)}` }));
    expect(html).toContain("Weak crack · Temporary");
    const at = (s: string) => html.indexOf(s);
    expect(at("Orders doubled on a one-off restocking")).toBeGreaterThan(-1);
    expect(at("Orders doubled on a one-off restocking")).toBeLessThan(at("What changed"));
    expect(at("What changed")).toBeLessThan(at("What moved the stock"));
    // The chip sits right after the words it quotes and opens the page with the quote highlighted.
    expect(html).toContain(`href="/x?item=${encodeURIComponent(`doc:${DOC}:2:Orders for 300mm wafer shippers doubled`)}"`);
    expect(at("shippers doubled")).toBeLessThan(at("p. 2"));
    expect(at("p. 2")).toBeLessThan(at("as two customers signed"));
    expect(html).toContain(`href="/x?item=${encodeURIComponent(`move:${SYMBOL}:2026-06-01`)}"`);
  });
});
