import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fairValues, narrativeDrivers, narratives, narrativeStates, priceMoveCauses, priceMoves, type AnalysisAnswer, type GoldNarrativeState } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import { documentPages, documents } from "@/db/schema/documents";
import { goldFinancialLines } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { movesText } from "./dimensions/analysis/facts";
import type { StoredSeries } from "./dimensions/analysis/series";
import { analysisPrompt, bindMoves, parseAnalysis } from "./dimensions/analysis/prompt";
import { dbStore, driverSeriesKeys, judgeThesis, keepPrintedCitations, memoryStore, pagesToRead, parseAnswer, promoteNarrativeStates, scopeMagnitude } from "./dimensions/narrative-state";

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

async function seedLines(line: string, periodType: "year" | "half" | "quarter", points: [string, number][]) {
  await db.insert(goldFinancialLines).values(points.map(([periodEnd, value]) => ({ symbol: SYMBOL, periodType, periodEnd, line, statement: "operating" as const, value, currency: "JPY", label: line, consolidated: true, sources: ["edinet"], alternatives: [] })));
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
    const prompts: { driver?: string; thesis?: string; reason?: string } = {};
    let n = 0;
    const fake: Complete = async ({ prompt }) => {
      n++;
      if (prompt.includes('"reason": "<the sentence>"')) {
        prompts.reason = prompt;
        return { text: JSON.stringify({ reason: "Customer restocking doubled orders to JPY 8.3B." }), model: "fake" };
      }
      if (prompt.includes("Where does this reason stand NOW")) {
        prompts.driver = prompt;
        return { text: JSON.stringify({ tag: "reversal:weak", p: 0.7, durability: "temporary", magnitude: { figure: "Orders", series: "hline:order-intake", from: "JPY 4.1B", to: "JPY 8.3B", change: "+102%", size: "material" }, since: "2026-11-10", pricedIn: "none", headline: "Orders double, one-off", explanation: "Management: Orders for 300mm wafer shippers doubled as two customers signed. The restocking ends next year.", citations: [{ doc: "D1", page: 2, quote: "Orders for 300mm wafer shippers doubled" }, { doc: "D1", page: 2, quote: "Invented sentence nobody printed" }], why: "A restocking." }), model: "fake" };
      }
      prompts.thesis = prompt;
      return { text: JSON.stringify({ tag: "reversal:weak", p: 0.6, signal: "weak", since: "2026-11-10", pricedIn: "none", why: "A temporary turn." }), model: "fake" };
    };
    await seedLines("order-intake", "half", [["2025-09-30", 4.1e9], ["2026-09-30", 8.3e9]]);
    const d = { side: "short" as const, version: "v1", narrative: "The market sees Miraial as a recovering wafer-carrier maker.", market: null, drivers: [{ id: `${SYMBOL}:short:1`, rank: 1, category: "Business economics", title: "Orders doubled on multi-year contracts", text: "Orders doubled.", moveIds: [`${SYMBOL}:2026-06-01`], exhibits: [{ title: "Orders", series: ["hline:order-intake"] }] }] };
    const payload = await judgeThesis(db, fake, dbStore(db), SYMBOL, d);
    expect(prompts.driver).toContain("This reason's own figures");
    expect(prompts.driver).toContain("[hline:order-intake]");
    expect(prompts.driver).toContain("First-half orders doubled on two multi-year contracts.");
    expect(prompts.driver).toContain("[D1 page 2] Summary of results, first half FY2026");
    expect(prompts.driver).toContain("strong needs a structural change AND a material one");
    expect(prompts.thesis).toContain("reversal:weak, temporary, Orders JPY 4.1B to JPY 8.3B (+102%), material");
    expect(prompts.thesis).toContain("Customer restocking doubled orders to JPY 8.3B.");
    // The thesis judge decides from its drivers only (v4): the company's figures reach the driver judges, never this one.
    expect(prompts.driver).toContain("order-intake");
    expect(prompts.thesis).not.toContain("order-intake");
    expect(prompts.thesis).toContain("it turns only as far as they turn");
    // The invented quote is dropped, never retried.
    expect(payload.drivers[0].citations).toEqual([expect.objectContaining({ documentId: DOC, page: 2, quote: "Orders for 300mm wafer shippers doubled" })]);
    // The reason is not the judge's job: a second call writes it from the finished judgment, at most 15 words.
    expect(prompts.driver).not.toContain('"reason"');
    expect(prompts.reason).toContain("Explanation: Management: Orders for 300mm wafer shippers doubled");
    expect(prompts.reason).toContain("at most 15 words");
    expect(prompts.reason).toContain("Figure: Orders JPY 4.1B to JPY 8.3B (+102%).");
    // One source per fact: durability and size are the judge's badges, never fed to the reason writer nor asked of it.
    expect(prompts.reason).toContain("State: reversal:weak.");
    expect(prompts.reason).not.toContain("(+102%), material");
    expect(prompts.reason).toContain("never write them");
    expect(payload.drivers[0].conclusion).toBe("Customer restocking doubled orders to JPY 8.3B.");
    expect(n).toBe(3);
    // Same input: never asked again.
    await judgeThesis(db, fake, dbStore(db), SYMBOL, d);
    expect(n).toBe(3);
    // A dry replay never writes: a memory store asks again.
    await judgeThesis(db, fake, memoryStore(), SYMBOL, d);
    expect(n).toBe(6);

    await promoteNarrativeStates(db, [{ subject: `${SYMBOL}:short`, payload, error: null, fetchedAt: new Date() } as unknown as BronzeFetch]);
    const states = await db.select().from(narrativeStates);
    expect(states.find((s) => s.level === "driver")).toMatchObject({ durability: "temporary", reason: "Customer restocking doubled orders to JPY 8.3B.", magnitude: { figure: "Orders", size: "material" }, citations: [expect.objectContaining({ page: 2 })] });
  });
});

describe("a driver's state reads only what that driver is about (PR-E, Kyungbang 2026-11-17)", () => {
  async function judgeOne(answerMagnitude: Record<string, unknown> | null, exhibits: { title: string; series: string[] }[]) {
    // Series A (operating income) barely moves; series B (net debt) moves most and belongs to another driver.
    await seedLines("operating-income", "year", [["2024-12-31", 100e9], ["2025-12-31", 103e9]]);
    await seedLines("net-debt", "year", [["2024-12-31", 196e9], ["2025-12-31", 92e9]]);
    await db.insert(narratives).values({ id: `${SYMBOL}:long`, symbol: SYMBOL, side: "long", text: "Profits swing and growth is flat.", detail: null, version: "v1", asOf: new Date() });
    let driverPrompt = "";
    const fake: Complete = async ({ prompt }) => {
      if (prompt.includes("Where does this reason stand NOW")) {
        driverPrompt = prompt;
        return { text: JSON.stringify({ tag: "continuation:weak", p: 0.6, durability: "n-a", magnitude: answerMagnitude, since: null, pricedIn: "none", headline: null, reason: "Operating income is flat at 103B.", explanation: "Flat.", citations: [], why: "Flat." }), model: "fake" };
      }
      return { text: JSON.stringify({ tag: "noise", p: 0.6, signal: "none", since: null, pricedIn: "none", why: "Nothing turns." }), model: "fake" };
    };
    const d = { side: "long" as const, version: "v1", narrative: "Profits swing and growth is flat.", market: null, drivers: [{ id: `${SYMBOL}:long:1`, rank: 1, category: "Business economics", title: "Profits swing and growth is almost flat", text: "Flat profits.", moveIds: [], exhibits }] };
    const payload = await judgeThesis(db, fake, memoryStore(), SYMBOL, d);
    return { driverPrompt, magnitude: payload.drivers[0].magnitude };
  }

  it("the driver's own series come first with their keys, the company's other figures as context only", async () => {
    const { driverPrompt } = await judgeOne(null, [{ title: "Operating income by year", series: ["line:operating-income"] }]);
    const own = driverPrompt.indexOf("This reason's own figures");
    expect(own).toBeGreaterThan(-1);
    expect(driverPrompt.slice(own, driverPrompt.indexOf("significant price move"))).toContain("[line:operating-income]");
    expect(driverPrompt.slice(own, driverPrompt.indexOf("significant price move"))).not.toContain("net-debt");
    expect(driverPrompt).toContain("You judge THIS reason only");
    expect(driverPrompt.indexOf("context only")).toBeGreaterThan(own);
  });

  it("a magnitude read on series B (moved most, another driver's) is dropped; on series A it stays", async () => {
    const onB = await judgeOne({ figure: "Net debt", series: "line:net-debt", from: "196B", to: "92B", change: "-53%", size: "material" }, [{ title: "Operating income by year", series: ["line:operating-income"] }]);
    expect(onB.magnitude).toBeNull();
    await close();
    ({ db, close } = await testDb());
    const onA = await judgeOne({ figure: "Operating income", series: "line:operating-income", from: "100B", to: "103B", change: "+3%", size: "small" }, [{ title: "Operating income by year", series: ["line:operating-income"] }]);
    expect(onA.magnitude).toMatchObject({ series: "line:operating-income", change: "+3%" });
  });

  it("a driver with no quantified series (only the share price) gets no magnitude and is told so", async () => {
    const r = await judgeOne({ figure: "Net debt", series: "line:net-debt", from: "196B", to: "92B", change: "-53%", size: "material" }, [{ title: "Share price", series: ["price"] }]);
    expect(r.driverPrompt).toContain("This reason has no reported figure of its own");
    expect(r.magnitude).toBeNull();
  });

  it("sibling keys of the driver's figure count as its own: other period lengths and derived ratios", () => {
    const s = (key: string, periodType: "year" | "quarter"): [string, StoredSeries] => [key, { key, label: key, unit: "currency", currency: "KRW", sources: [], periodType, points: new Map([["2025-12-31", 1]]) }];
    const catalog = new Map<string, StoredSeries>([s("line:revenue", "year"), s("qline:revenue", "quarter"), s("metric:revenue-growth", "year"), s("metric:net-debt", "year"), s("consensus:revenue", "year"), s("price", "year")]);
    expect(driverSeriesKeys(catalog, [{ title: "Revenue", series: ["line:revenue", "price"] }])).toEqual(["line:revenue", "metric:revenue-growth", "qline:revenue"]);
    expect(scopeMagnitude({ figure: "x", series: "metric:net-debt", from: null, to: null, change: null, size: "small" }, new Set(["line:revenue"]))).toBeNull();
  });
});

describe("the driver panel: the reason first, then what changed with its quotes, then the moves", () => {
  it("renders in that order, each quote a chip opening its page, each move opening its panel", async () => {
    const { DriverReason } = await import("@/console/driver-reason");
    const state = { effect: "reversal", strength: "weak", why: "A restocking.", reason: "Customer restocking doubled orders to JPY 8.3B.", durability: "temporary", magnitude: { figure: "Orders", from: "JPY 4.1B", to: "JPY 8.3B", change: "+102%", size: "material" }, explanation: "Management: Orders for 300mm wafer shippers doubled as two customers signed. It ends next year.", citations: [{ documentId: DOC, page: 2, quote: "Orders for 300mm wafer shippers doubled", title: "Summary of results" }] } as unknown as GoldNarrativeState;
    const moves = [{ id: `${SYMBOL}:2026-06-01`, startDay: "2026-06-01", direction: "up", returnPct: 0.2, cause: { fact: "First-half orders doubled." } }] as never;
    const html = renderToStaticMarkup(createElement(DriverReason, { state, side: "short", moves, hrefFor: (item: string) => `/x?item=${encodeURIComponent(item)}` }));
    expect(html).toContain("Weak crack · Temporary");
    const at = (s: string) => html.indexOf(s);
    expect(at("Customer restocking doubled orders")).toBeGreaterThan(-1);
    expect(at("Customer restocking doubled orders")).toBeLessThan(at("What changed"));
    expect(at("What changed")).toBeLessThan(at("What moved the stock"));
    // The chip sits right after the words it quotes and opens the page with the quote highlighted.
    expect(html).toContain(`href="/x?item=${encodeURIComponent(`doc:${DOC}:2:Orders for 300mm wafer shippers doubled`)}"`);
    expect(at("shippers doubled")).toBeLessThan(at("p. 2"));
    expect(at("p. 2")).toBeLessThan(at("as two customers signed"));
    expect(html).toContain(`href="/x?item=${encodeURIComponent(`move:${SYMBOL}:2026-06-01`)}"`);
  });
});
