import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyses, evidence, exhibits, fairValueHistory, fairValues, marketReactions, narrativeDrivers, narrativeRationales, narratives, narrativeStates, researchReports, signalChanges, signals, signalStates } from "@/db/schema/analysis";
import { valuationSyntheses } from "@/db/schema/valuation";
import { goldFinancialLines, financialMetrics } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { analysis, sidesFor } from "./dimensions/analysis";
import { fairValueAt, marketReactionDim, reactionLine, reactionOf } from "./dimensions/market-reaction";
import { analysisPrompt, parseAnalysis } from "./dimensions/analysis/prompt";
import { narrativeSinceDim, sinceChoices } from "./dimensions/narrative-since";
import { batchSubject, evidenceDim, parseBatch, parseBatchSubject, parseEvidenceSubject, verdictRank } from "./dimensions/evidence";
import { collectPlan, dimensionsFor, stagesFor, STAGES, DIMENSIONS } from "./registry";
import { narrativeStateDim } from "./dimensions/narrative-state";
import { combineTheses, onFairValueSide, signalsDim } from "./dimensions/signals";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const SYMBOL = "101160.KQ";

const ANSWER = {
  fairValue: { value: 40000, currency: "KRW", label: "8x EV/EBITDA, 5-year median", method: "8x EV/EBITDA, its 5-year median, on FY2025 EBITDA KRW 70B, plus net cash KRW 100B, over 16.5M shares", inputs: [{ label: "EBITDA FY2025", value: 70e9, period: "2025-12" }] },
  narrative: "The market prices Worldex as a cyclical parts maker.",
  narrativeDetail: "Its margins held while sales dipped.",
  drivers: [
    { category: "Industry & cycle", title: "Memory capex drives etch parts demand", summary: "Chip makers buy fewer parts when they cut spending.", text: "Revenue fell 5% in 2025.", exhibits: [{ title: "Revenue by year", chart: "bar", series: ["line:revenue", "line:not-stored"], takeaway: "Sales dipped in 2025." }] },
    { category: "Balance sheet & capital", title: "Net cash funds buybacks", text: "Net cash of KRW 100B.", exhibits: [{ title: "Invented", chart: "line", series: ["metric:made-up"], takeaway: "x" }, { title: "Operating margin", chart: "line", series: ["metric:operating-margin"], takeaway: "Margins held." }] },
  ],
};

let calls: string[] = [];
let lastEvidencePrompt = "";
let lastThesisPrompt = "";
let analysisPrompts: string[] = [];
const fake: Complete = async ({ prompt, system }) => {
  if (system.includes("one-line signal notes")) {
    calls.push("note");
    expect(prompt).toContain("ONE short sentence");
    expect(prompt).not.toMatch(/Fair value \d/);
    return { text: prompt.includes("to BUY (weak inflection)") ? "BUY: a buyback trust turns the cash story." : "Signal moved.", model: "fake" };
  }
  if (system.includes("equity research reports")) {
    calls.push("report");
    return { text: "## Executive Summary\nWorldex — fair value KRW 40,000.\n[EXHIBIT 1]", model: "fake" };
  }
  if (system.includes("WHY the market holds")) {
    calls.push("rationale");
    return { text: JSON.stringify({ summary: "The market sees a cyclical parts maker after a 2025 dip.", claims: [{ text: "Revenue fell to KRW 291.8B in 2025.", drivers: [1, 7], sources: [{ type: "exhibit", ref: "1", label: "Revenue" }, { type: "bogus", ref: "x" }] }], exhibits: [{ title: "Share price", chart: "line", series: ["line:revenue", "nope"], takeaway: "Back to a year ago." }, { title: "Invented", chart: "bar", series: ["nope"], takeaway: "x" }] }), model: "fake" };
  }
  const verdict = (v: string, reason: string) => ({ text: JSON.stringify({ verdict: v, probability: 0.8, cited_sentence: "buyback", reason }), model: "fake" });
  if (prompt.includes("Since which month has the market held THIS story")) {
    calls.push("since");
    expect(prompt).toContain("vs today's fair value");
    // The story took hold 2 months ago.
    return verdict(sinceChoices()[4], "The price fell below fair value two months ago.");
  }
  if (prompt.includes("For EACH item below and EACH driver")) {
    lastEvidencePrompt = prompt;
    calls.push("evidence");
    // The buyback reverses the cash reason (driver 2) and is noise for the cycle reason (driver 1).
    const n = (prompt.match(/^\[\d+\]/gm) ?? []).length;
    return { text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, pricedIn: "none", drivers: { "1": { tag: "noise", p: 0.8, why: "Nothing on the cycle.", cited: null }, "2": { tag: "reversal:strong", p: 0.8, why: "A buyback trust returns cash.", cited: "buyback" } } })) }), model: "fake" };
  }
  if (prompt.includes("Where does this reason stand NOW")) {
    calls.push("driver-state");
    const turned = prompt.includes("[reversal:strong");
    return { text: JSON.stringify({ tag: turned ? "reversal:strong" : "noise", p: 0.8, since: turned ? "2026-11-02" : null, pricedIn: turned ? "none" : null, headline: turned ? "Buyback returns 10% of cash" : null, why: turned ? "The buyback turns the cash reason." : "No news on it." }), model: "fake" };
  }
  if (prompt.includes("does this thesis give a")) {
    lastThesisPrompt = prompt;
    calls.push("thesis-state");
    const turned = prompt.includes("reversal:strong");
    return { text: JSON.stringify({ tag: turned ? "reversal:weak" : "noise", p: 0.8, signal: turned ? "weak" : "none", since: turned ? "2026-11-02" : null, pricedIn: "none", why: turned ? "One of two reasons turns, the price still 25% under fair value." : "Nothing moves." }), model: "fake" };
  }
  analysisPrompts.push(prompt);
  calls.push("analysis");
  return { text: JSON.stringify(ANSWER), model: "fake" };
};

const ctx = (): SourceContext => ({ env: { REPO_ROOT, CLAUDE_OAUTH_TOKEN: "t" }, fetch: (async () => new Response("", { status: 404 })) as typeof fetch, complete: fake });

let db: Db;
let close: () => Promise<void>;
const line = (periodEnd: string, l: string, value: number, statement: "income" | "balance" = "income") => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd, line: l, statement, value, currency: "KRW", label: l, consolidated: true, sources: ["dart", "yahoo"], alternatives: [] });

beforeEach(async () => {
  calls = [];
  analysisPrompts = [];
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await db.insert(goldFinancialLines).values([line("2024-12", "revenue", 306.8e9), line("2025-12", "revenue", 291.8e9), line("2025-12", "cash", 143e9, "balance")]);
  await db.insert(financialMetrics).values(["2024-12", "2025-12"].map((p, i) => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd: p, metric: "operating-margin", value: 0.2 - i * 0.01, unit: "ratio" as const, currency: null, formula: "x", inputs: [], sources: ["dart"] })));
  await db.insert(gold.quotes).values({ symbol: SYMBOL, date: "2026-11-04", close: 30000, currency: "KRW", sources: ["naver"] });
  // The Fair Value is the valuation pyramid's (valuation.test.ts); the analysis reads it.
  await db.insert(fairValues).values({ symbol: SYMBOL, value: 40000, currency: "KRW", low: 35000, high: 46000, method: "EV/EBITDA 60%, Listed peers 40%", label: "Mostly EV/EBITDA", author: "claude", claudeValue: 40000, inputs: [] });
  await db.insert(theses).values({ symbol: SYMBOL, narrative: "A generic chip-parts supplier." }).onConflictDoUpdate({ target: theses.symbol, set: { narrative: "A generic chip-parts supplier." } });
});
afterEach(async () => close());

describe("analysis dimension", () => {
  it("writes Narrative, Drivers, Exhibits bound to stored series only, and the Report, once per input; reads the Fair Value, never writes it", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ value: 40000, label: "Mostly EV/EBITDA" });
    // The price (30,000) sits below the fair value range (35,000 to 46,000): the long thesis only.
    expect(await db.select().from(narratives)).toMatchObject([{ id: `${SYMBOL}:long`, side: "long", text: "The market prices Worldex as a cyclical parts maker.", detail: "Its margins held while sales dipped." }]);
    expect(analysisPrompts[0]).toContain("Write the LONG thesis");
    expect((await db.select().from(narrativeDrivers)).find((d) => d.rank === 1)?.summary).toBe("Chip makers buy fewer parts when they cut spending.");
    const drivers = await db.select().from(narrativeDrivers).where(eq(narrativeDrivers.symbol, SYMBOL));
    expect(drivers.map((d) => [d.rank, d.category])).toEqual([[1, "Industry & cycle"], [2, "Balance sheet & capital"]]);
    const ex = (await db.select().from(exhibits).where(eq(exhibits.symbol, SYMBOL))).sort((a, b) => a.number - b.number);
    // The unknown series key and the invented exhibit are dropped; the numbers come from gold.
    expect(ex.map((e) => [e.number, e.driverId, e.series.map((s) => s.key)])).toEqual([[1, `${SYMBOL}:long:1`, ["line:revenue"]], [2, `${SYMBOL}:long:2`, ["metric:operating-margin"]], [3, `${SYMBOL}:long:rationale`, ["line:revenue"]]]);
    expect(ex[0].points).toEqual([{ period: "2024-12", values: { "line:revenue": 306.8e9 } }, { period: "2025-12", values: { "line:revenue": 291.8e9 } }]);
    const [report] = await db.select().from(researchReports);
    expect(report.markdown).not.toMatch(/[—–]/);
    expect(report.markdown).toContain("not investment advice");
    expect(calls).toEqual(["analysis", "rationale", "report"]);
    // Narrative Rationale: claims with valid drivers and sources only; its exhibit numbered after the drivers'.
    const [rat] = await db.select().from(narrativeRationales);
    expect(rat.claims).toEqual([{ text: "Revenue fell to KRW 291.8B in 2025.", drivers: [1], sources: [{ type: "exhibit", ref: "1", label: "Revenue" }] }]);
    const rex = await db.select().from(exhibits).where(eq(exhibits.driverId, `${SYMBOL}:long:rationale`));
    expect(rex.map((e) => [e.id, e.number, e.series.map((s) => s.key)])).toEqual([[`${SYMBOL}:long:rationale:1`, 3, ["line:revenue"]]]);
    // Same inputs: never asked again.
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["analysis", "rationale", "report"]);
  });

  it("inside the fair value range writes BOTH theses, each handed its previous version to keep word for word", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    await db.update(gold.quotes).set({ close: 41000 }).where(eq(gold.quotes.symbol, SYMBOL));
    analysisPrompts = [];
    calls = [];
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect(calls.filter((c) => c === "analysis")).toHaveLength(2);
    const long = analysisPrompts.find((p) => p.includes("Write the LONG thesis"))!;
    const short = analysisPrompts.find((p) => p.includes("Write the SHORT thesis"))!;
    expect(long).toContain("Your previous version of the LONG thesis");
    expect(long).toContain("Keep it WORD FOR WORD");
    expect(short).not.toContain("Your previous version");
    expect((await db.select().from(narratives)).map((n) => n.id).sort()).toEqual([`${SYMBOL}:long`, `${SYMBOL}:short`]);
    expect((await db.select().from(narrativeDrivers)).map((d) => d.id).sort()).toEqual([`${SYMBOL}:long:1`, `${SYMBOL}:long:2`, `${SYMBOL}:short:1`, `${SYMBOL}:short:2`]);
    // Same words = same version: the judgments built on the long thesis stay valid.
    const versions = (await db.select().from(analyses)).filter((a) => a.side === "long");
    expect(versions).toHaveLength(2);
    // Back below the range: the short thesis drops out of gold.
    await db.update(gold.quotes).set({ close: 30000 }).where(eq(gold.quotes.symbol, SYMBOL));
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(narratives)).map((n) => n.id)).toEqual([`${SYMBOL}:long`]);
  });

  it("a news item never re-writes the narrative: news stay out of the analysis hash", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    await db.insert(gold.filings).values({ id: "6f1d1a52-3333-4a3b-9c1d-000000000001", symbol: SYMBOL, registry: "dart", filingKey: "h1", form: null, title: "Q3 results", filedAt: new Date(), url: null, language: "ko", sources: ["dart"] });
    calls = [];
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);
  });

  it("judges each item against EACH driver, tags each driver then the ticker, and signals BUY below fair value; the first signal is the baseline", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    await runDimension(db, signalsDim, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(signals).where(eq(signals.symbol, SYMBOL)))[0]).toMatchObject({ signal: "none", strength: "noise" });
    expect(await db.select().from(signalChanges)).toHaveLength(0);

    const filingId = "6f1d1a52-1111-4a3b-9c1d-000000000001";
    await db.insert(gold.filings).values({ id: filingId, symbol: SYMBOL, registry: "dart", filingKey: "r1", form: null, title: "Share buyback trust", filedAt: new Date(), url: "https://dart/x", language: "ko", sources: ["dart"] });
    // A filing older than the 12-month window is not judged.
    await db.insert(gold.filings).values({ id: "6f1d1a52-1111-4a3b-9c1d-000000000002", symbol: SYMBOL, registry: "dart", filingKey: "r0", form: null, title: "Old notice", filedAt: new Date(Date.now() - 400 * 86_400_000), url: null, language: "ko", sources: ["dart"] });
    calls = [];
    await runDimension(db, evidenceDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["evidence"]);
    const all = await db.select().from(evidence);
    expect(all).toHaveLength(1);
    const [e] = all;
    // One verdict per driver; the item's top line is its strongest verdict.
    expect(e.verdicts.map((v) => [v.driverId, v.effect, v.strength, v.pricedIn])).toEqual([[`${SYMBOL}:long:1`, "noise", "noise", "none"], [`${SYMBOL}:long:2`, "reversal", "strong", "none"]]);
    expect(e).toMatchObject({ id: `${SYMBOL}|filing:${filingId}`, headline: "Share buyback trust", filingIds: [filingId], driverId: `${SYMBOL}:long:2`, effect: "reversal", strength: "strong", exhibitId: `${SYMBOL}:long:2:1` });
    // The judge reads the thesis and today's price vs the fair value range.
    expect(lastEvidencePrompt).toContain("long thesis: the PESSIMISTIC story");
    expect(lastEvidencePrompt).toContain("fair value 40000 (range 35000 to 46000)");

    calls = [];
    await runDimension(db, narrativeStateDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["driver-state", "driver-state", "thesis-state"]);
    const states = await db.select().from(narrativeStates);
    expect(Object.fromEntries(states.map((x) => [x.id, `${x.level} ${x.effect}:${x.strength} ${x.signal ?? "-"}`]))).toEqual({ [`${SYMBOL}:long:1`]: "driver noise:noise -", [`${SYMBOL}:long:2`]: "driver reversal:strong -", [`${SYMBOL}:long`]: "thesis reversal:weak weak" });
    expect(states.find((x) => x.id === `${SYMBOL}:long:2`)).toMatchObject({ evidenceIds: [e.id], headline: "Buyback returns 10% of cash", since: "2026-11-02", pricedIn: "none" });
    // The thesis judge decides the signal with the fair value, its range, the price path and today's date in front of it.
    expect(lastThesisPrompt).toContain("does this thesis give a BUY NOW");
    expect(lastThesisPrompt).toContain("range 35000 to 46000");
    expect(lastThesisPrompt).toContain("Month-end closes");
    expect(lastThesisPrompt).toContain(`Today is ${new Date().toISOString().slice(0, 10)}`);
    // Same inputs: never asked again.
    calls = [];
    await runDimension(db, narrativeStateDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);

    await runDimension(db, signalsDim, { trigger: "test", ctx: ctx() });
    const [s] = await db.select().from(signals).where(eq(signals.symbol, SYMBOL));
    expect(s).toMatchObject({ signal: "BUY", strength: "weak", side: "long", fairValue: 40000, quote: 30000, evidenceIds: [e.id] });
    expect(s.theses).toEqual([{ side: "long", signal: "weak", effect: "reversal", strength: "weak", why: "One of two reasons turns, the price still 25% under fair value.", since: "2026-11-02" }]);
    expect(s.gapPct).toBeCloseTo(-0.25, 6);
    const [change] = await db.select().from(signalChanges);
    expect(change).toMatchObject({ symbol: SYMBOL, fromSignal: "none", toSignal: "BUY", toStrength: "weak", updateNote: "BUY: a buyback trust turns the cash story." });

    // A note written by an older prompt is written again once.
    await db.update(signalStates).set({ updateNote: "A long paragraph of fair value arithmetic.", noteVersion: null }).where(eq(signalStates.baseline, 0));
    calls = [];
    await runDimension(db, signalsDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["note"]);
    expect((await db.select().from(signalChanges))[0].updateNote).toBe("BUY: a buyback trust turns the cash story.");
    calls = [];
    await runDimension(db, signalsDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);
  });

  it("asks for drivers that SUPPORT the narrative, never one against it", () => {
    const p = analysisPrompt("facts", "long");
    expect(p).toContain("Every driver SUPPORTS the narrative");
    expect(p).not.toMatch(/weakens/);
  });

  it("asks for 1 to 5 drivers, none invented and none left out, and says when the consensus is one", () => {
    const p = analysisPrompt("facts", "short");
    expect(p).toContain("1 to 5");
    expect(p).toContain("Never invent a reason");
    expect(p).toContain("never leave one out");
    expect(p).toContain('"Consensus expectations"');
    expect(p).toContain("agrees with the narrative");
  });

  it("keeps up to 5 drivers and refuses the old category name", () => {
    const d = (category: string, i: number) => ({ category, title: `Reason ${i}`, text: "t", exhibits: [] });
    const base = { fairValue: { value: 1, currency: "USD", method: "m" }, narrative: "n" };
    const six = parseAnalysis(JSON.stringify({ ...base, drivers: [1, 2, 3, 4, 5, 6].map((i) => d("Consensus expectations", i)) }));
    expect(six.drivers.map((x) => x.title)).toEqual(["Reason 1", "Reason 2", "Reason 3", "Reason 4", "Reason 5"]);
    expect(() => parseAnalysis(JSON.stringify({ ...base, drivers: [d("Expectations", 1)] }))).toThrow(/not a Driver Category/);
  });
});

describe("Too old (Kevin 2026-11-06)", () => {
  it("news from before the month the current story took hold are Too old: never judged, never under a driver, never a signal", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    await db.insert(gold.priceBars).values([{ symbol: SYMBOL, date: new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10), open: 40000, high: 40000, low: 40000, close: 40000, volume: 1, sources: ["naver"], alternatives: [] }, { symbol: SYMBOL, date: new Date().toISOString().slice(0, 10), open: 30000, high: 30000, low: 30000, close: 30000, volume: 1, sources: ["naver"], alternatives: [] }]);
    calls = [];
    await runDimension(db, narrativeSinceDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["since"]);
    calls = [];
    await runDimension(db, narrativeSinceDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);

    const recent = "6f1d1a52-2222-4a3b-9c1d-000000000001";
    const old = "6f1d1a52-2222-4a3b-9c1d-000000000002";
    await db.insert(gold.filings).values([
      { id: recent, symbol: SYMBOL, registry: "dart", filingKey: "n1", form: null, title: "Share buyback trust", filedAt: new Date(), url: null, language: "ko", sources: ["dart"] },
      { id: old, symbol: SYMBOL, registry: "dart", filingKey: "n0", form: null, title: "New debt agreement", filedAt: new Date(Date.now() - 120 * 86_400_000), url: null, language: "ko", sources: ["dart"] },
    ]);
    calls = [];
    await runDimension(db, evidenceDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["evidence"]);
    expect(lastEvidencePrompt).toContain("Share buyback trust");
    expect(lastEvidencePrompt).not.toContain("New debt agreement");
    const rows = await db.select().from(evidence);
    const tooOld = rows.find((r) => r.id === `${SYMBOL}|filing:${old}`)!;
    expect(tooOld).toMatchObject({ effect: "too-old", strength: "noise", driverId: null, verdicts: [] });
    expect(tooOld.why).toMatch(/^Before \w+ \d{4}, when the market adopted its current story/);
    expect(rows.find((r) => r.id === `${SYMBOL}|filing:${recent}`)).toMatchObject({ effect: "reversal", strength: "strong" });

    await runDimension(db, narrativeStateDim, { trigger: "test", ctx: ctx() });
    const states = await db.select().from(narrativeStates);
    expect(states.flatMap((x) => x.evidenceIds)).not.toContain(tooOld.id);
  });
});

describe("theses and the surfacing rule (Kevin 2026-11-09)", () => {
  it("below the fair value range: long only; above: short only; inside: both compete", () => {
    const fv = { value: 100, low: 80, high: 120 };
    expect(sidesFor(70, fv)).toEqual(["long"]);
    expect(sidesFor(130, fv)).toEqual(["short"]);
    expect(sidesFor(100.2, fv)).toEqual(["long", "short"]);
    expect(sidesFor(100.2, { value: 100, low: null, high: null })).toEqual(["short"]);
  });
  const st = (side: "long" | "short", signal: "strong" | "weak" | "noise") => ({ side, signal, effect: "reversal" as const, strength: "strong" as const, why: `${side} why`, since: "2026-11-05", evidenceIds: [side] });
  it("one thesis: its own signal, a long a BUY, a short a SELL", () => {
    expect(combineTheses([st("long", "strong")])).toMatchObject({ signal: "BUY", strength: "strong", side: "long", evidenceIds: ["long"] });
    expect(combineTheses([st("short", "weak")])).toMatchObject({ signal: "SELL", strength: "weak", side: "short" });
    expect(combineTheses([st("long", "noise")])).toMatchObject({ signal: "none", side: null, why: "long why" });
  });
  it("two theses: only the one that signals ALONE surfaces; both or neither = no signal", () => {
    expect(combineTheses([st("long", "noise"), st("short", "strong")])).toMatchObject({ signal: "SELL", side: "short" });
    expect(combineTheses([st("long", "weak"), st("short", "strong")])).toMatchObject({ signal: "none", strength: "noise", side: null });
    expect(combineTheses([st("long", "noise"), st("short", "noise")])).toMatchObject({ signal: "none", side: null });
    // BUY only below the fair value, SELL only above (MNRO 2026-11-09: a SELL 21% under it).
    expect(onFairValueSide(combineTheses([st("short", "weak")]), -0.21)).toMatchObject({ signal: "none", strength: "noise", side: null });
    expect(onFairValueSide(combineTheses([st("short", "weak")]), 0.1)).toMatchObject({ signal: "SELL" });
    expect(onFairValueSide(combineTheses([st("long", "strong")]), 0.05)).toMatchObject({ signal: "none" });
    expect(onFairValueSide(combineTheses([st("long", "strong")]), -0.3)).toMatchObject({ signal: "BUY" });
  });
  it("NVRI 2026-11-09: good news on the long thesis never turn into a SELL because the price sits 0.2% above fair value", () => {
    // The price is inside the range; the long thesis turned but the judge saw it priced in (no signal); the short one is noise.
    expect(combineTheses([{ ...st("long", "noise"), why: "The turn is already in the price." }, st("short", "noise")]).signal).toBe("none");
  });
  it("subject grammar and verdict order", () => {
    expect(parseEvidenceSubject("101160.KQ|news:abc-1#long:2")).toEqual({ symbol: "101160.KQ", kind: "news", id: "abc-1", side: "long", rank: 2 });
    expect(parseBatchSubject(batchSubject("CCLD", "short", [{ kind: "news", id: "a:1" }, { kind: "filing", id: "b" }]))).toEqual({ symbol: "CCLD", side: "short", items: [{ kind: "news", id: "a:1" }, { kind: "filing", id: "b" }] });
    const order = (["continuation:weak", "reversal:weak", "noise:noise", "continuation:strong", "reversal:strong"] as const).map((t) => t.split(":") as [string, string]);
    expect([...order].sort((a, b) => verdictRank({ effect: a[0] as never, strength: a[1] as never }) - verdictRank({ effect: b[0] as never, strength: b[1] as never })).map((x) => x.join(":"))).toEqual(["reversal:strong", "continuation:strong", "reversal:weak", "continuation:weak", "noise:noise"]);
  });
});

describe("Market Reaction (Kevin 2026-11-09)", () => {
  const bars = [
    { date: "2026-10-30", close: 18.42 },
    { date: "2026-11-02", close: 17.98 },
    { date: "2026-11-03", close: 19.03 },
    { date: "2026-11-04", close: 20.51 },
    { date: "2026-11-05", close: 23.36 },
    { date: "2026-11-06", close: 23.85 },
  ];
  const bench = bars.map((b) => ({ date: b.date, close: 100 }));
  const history = [{ day: "2026-11-06", value: 22.43, low: 17.05, high: 31.23 }];
  it("what the price did around a news item vs the S&P 500, and the fair value then (the first one when the news is older) and now", () => {
    const r = reactionOf({ id: "NVRI|news:x", symbol: "NVRI", day: "2026-11-05" }, bars, bench, history, { day: "2026-11-09", value: 23.8, low: 18.34, high: 27.45 }, "USD");
    expect(r).toMatchObject({ beforeDay: "2026-11-04", closeBefore: 20.51, closeNext: 23.36, closeNow: 23.85, benchNext: 0, fvDay: "2026-11-06", fvThen: 22.43, fvNow: 23.8 });
    expect(r.returnNext).toBeCloseTo(0.139, 3);
    expect(reactionLine(r)).toContain("23.85 today (+16.3% since, S&P 500 +0.0%)");
    expect(reactionLine(r)).toContain("fair value then 22.43 (range 17.05 to 31.23) (first computed 2026-11-06)");
    expect(fairValueAt(history, "2026-11-07")?.value).toBe(22.43);
  });
  it("the dimension writes the fair value history (last synthesis of each day) and one reaction per news item and filing", async () => {
    const synth = (at: string, base: number) => ({ symbol: SYMBOL, inputHash: at, result: { currency: "KRW", low: base * 0.9, base, high: base * 1.1, weights: [], label: "l", summary: "s", report: "r" }, model: "m", bronzeId: crypto.randomUUID(), createdAt: new Date(at) });
    await db.insert(valuationSyntheses).values([synth("2026-11-06T10:00:00Z", 38000), synth("2026-11-06T20:00:00Z", 39000), synth("2026-11-08T10:00:00Z", 40000)]);
    await db.insert(gold.filings).values({ id: "6f1d1a52-4444-4a3b-9c1d-000000000001", symbol: SYMBOL, registry: "dart", filingKey: "m1", form: null, title: "Q3", filedAt: new Date(), url: null, language: "ko", sources: ["dart"] });
    await runDimension(db, marketReactionDim, { trigger: "test", ctx: ctx() });
    expect((await db.select().from(fairValueHistory)).map((h) => [h.day, h.value]).sort()).toEqual([["2026-11-06", 39000], ["2026-11-08", 40000]]);
    expect(await db.select().from(marketReactions)).toMatchObject([{ id: `${SYMBOL}|filing:6f1d1a52-4444-4a3b-9c1d-000000000001`, fvNow: 40000 }]);
  });
});

describe("speed (Kevin 2026-11-06)", () => {
  it("a batch answer missing an item x driver pair fails loud", () => {
    expect(() => parseBatch(JSON.stringify({ items: [{ n: 1, drivers: { "1": { tag: "noise" } } }] }), 2, [1])).toThrow(/2#1/);
    expect(parseBatch(JSON.stringify({ items: [{ n: 1, drivers: { "1": { tag: "reversal:weak", p: 2, why: "x" } } }] }), 1, [1]).get("1#1")).toEqual({ tag: "reversal:weak", p: 0.5, why: "x", cited: null, pricedIn: null });
  });
  it("every dimension sits in exactly one stage, after the ones it reads", () => {
    expect(STAGES.flat().sort()).toEqual(DIMENSIONS.map((d) => d.name).sort());
    const at = (n: string) => STAGES.findIndex((s) => s.includes(n));
    for (const [before, after] of [["company-profile", "news"], ["price", "financials"], ["filings", "financials"], ["consensus", "peers"], ["peers", "valuation"], ["valuation", "analysis"], ["valuation", "market-reaction"], ["market-reaction", "evidence"], ["analysis", "evidence"], ["analysis", "narrative-since"], ["narrative-since", "evidence"], ["evidence", "narrative-state"], ["narrative-state", "signals"], ["intraday-price", "market-reaction"], ["intraday-price", "signals"]]) expect(at(before)).toBeLessThan(at(after));
    expect(stagesFor(dimensionsFor("from:valuation")).map((s) => s.map((d) => d.name))).toEqual([["valuation", "intraday-price"], ["analysis", "market-reaction"], ["narrative-since"], ["evidence"], ["narrative-state"], ["signals"]]);
  });
  it("a merge collects only what its files can move", () => {
    expect(collectPlan(["web/src/console/analysis.tsx", "site/src/app/page.tsx", "CLAUDE.md"])).toBeNull();
    expect(collectPlan(["web/src/collectors/dimensions/valuation/prompt.ts", "web/src/collectors/dimensions/evidence/index.ts"])).toBe("from:valuation");
    expect(collectPlan(["web/src/collectors/dimensions/cover-photos/index.ts"])).toBe("cover-photos");
    expect(collectPlan(["web/src/collectors/runner.ts"])).toBe("core");
    expect(collectPlan(["web/src/collectors/valuation.test.ts"])).toBeNull();
  });
});

