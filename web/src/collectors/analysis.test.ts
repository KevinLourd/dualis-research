import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidence, exhibits, fairValues, narrativeDrivers, narrativeRationales, narratives, narrativeStates, researchReports, signalChanges, signals } from "@/db/schema/analysis";
import { goldFinancialLines, financialMetrics } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { analysis } from "./dimensions/analysis";
import { analysisPrompt } from "./dimensions/analysis/prompt";
import { evidenceDim, parseEvidenceSubject, verdictRank } from "./dimensions/evidence";
import { narrativeStateDim } from "./dimensions/narrative-state";
import { computeSignal, signalsDim } from "./dimensions/signals";
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
const fake: Complete = async ({ prompt, system }) => {
  if (system.includes("short research update notes")) {
    calls.push("note");
    return { text: "Worldex moved to BUY: a buyback inflects the narrative.", model: "fake" };
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
  if (prompt.includes("What does this news item or filing do to THIS reason")) {
    calls.push("evidence");
    // The buyback reverses the cash reason (driver 2) and is noise for the cycle reason (driver 1).
    return prompt.includes("Net cash funds buybacks") ? verdict("reversal:strong", "A buyback trust returns cash.") : verdict("noise", "Nothing on the cycle.");
  }
  if (prompt.includes("Where does this reason stand NOW")) {
    calls.push("driver-state");
    return prompt.includes("[reversal:strong]") ? verdict("reversal:strong", "The buyback turns the cash reason.") : verdict("noise", "No news on it.");
  }
  if (prompt.includes("Where does the WHOLE narrative stand")) {
    calls.push("ticker-state");
    return prompt.includes("reversal:strong") ? verdict("reversal:weak", "One of two reasons turns.") : verdict("noise", "Nothing moves.");
  }
  calls.push("analysis");
  return { text: JSON.stringify(ANSWER), model: "fake" };
};

const ctx = (): SourceContext => ({ env: { REPO_ROOT, CLAUDE_OAUTH_TOKEN: "t" }, fetch: (async () => new Response("", { status: 404 })) as typeof fetch, complete: fake });

let db: Db;
let close: () => Promise<void>;
const line = (periodEnd: string, l: string, value: number, statement: "income" | "balance" = "income") => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd, line: l, statement, value, currency: "KRW", label: l, consolidated: true, sources: ["dart", "yahoo"], alternatives: [] });

beforeEach(async () => {
  calls = [];
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await db.insert(goldFinancialLines).values([line("2024-12", "revenue", 306.8e9), line("2025-12", "revenue", 291.8e9), line("2025-12", "cash", 143e9, "balance")]);
  await db.insert(financialMetrics).values(["2024-12", "2025-12"].map((p, i) => ({ symbol: SYMBOL, periodType: "year" as const, periodEnd: p, metric: "operating-margin", value: 0.2 - i * 0.01, unit: "ratio" as const, currency: null, formula: "x", inputs: [], sources: ["dart"] })));
  await db.insert(gold.quotes).values({ symbol: SYMBOL, date: "2026-11-04", close: 30000, currency: "KRW", sources: ["naver"] });
  await db.insert(theses).values({ symbol: SYMBOL, narrative: "A generic chip-parts supplier." }).onConflictDoUpdate({ target: theses.symbol, set: { narrative: "A generic chip-parts supplier." } });
});
afterEach(async () => close());

describe("analysis dimension", () => {
  it("writes Fair Value, Narrative, Drivers, Exhibits bound to stored series only, and the Report, once per input", async () => {
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ value: 40000, currency: "KRW", author: "claude", label: "8x EV/EBITDA, 5-year median" });
    expect((await db.select().from(narratives))[0]).toMatchObject({ text: "The market prices Worldex as a cyclical parts maker.", detail: "Its margins held while sales dipped." });
    expect((await db.select().from(narrativeDrivers)).find((d) => d.rank === 1)?.summary).toBe("Chip makers buy fewer parts when they cut spending.");
    const drivers = await db.select().from(narrativeDrivers).where(eq(narrativeDrivers.symbol, SYMBOL));
    expect(drivers.map((d) => [d.rank, d.category])).toEqual([[1, "Industry & cycle"], [2, "Balance sheet & capital"]]);
    const ex = (await db.select().from(exhibits).where(eq(exhibits.symbol, SYMBOL))).sort((a, b) => a.number - b.number);
    // The unknown series key and the invented exhibit are dropped; the numbers come from gold.
    expect(ex.map((e) => [e.number, e.driverId, e.series.map((s) => s.key)])).toEqual([[1, `${SYMBOL}:1`, ["line:revenue"]], [2, `${SYMBOL}:2`, ["metric:operating-margin"]], [3, `${SYMBOL}:rationale`, ["line:revenue"]]]);
    expect(ex[0].points).toEqual([{ period: "2024-12", values: { "line:revenue": 306.8e9 } }, { period: "2025-12", values: { "line:revenue": 291.8e9 } }]);
    const [report] = await db.select().from(researchReports);
    expect(report.markdown).not.toMatch(/[—–]/);
    expect(report.markdown).toContain("not investment advice");
    expect(calls).toEqual(["analysis", "rationale", "report"]);
    // Narrative Rationale: claims with valid drivers and sources only; its exhibit numbered after the drivers'.
    const [rat] = await db.select().from(narrativeRationales);
    expect(rat.claims).toEqual([{ text: "Revenue fell to KRW 291.8B in 2025.", drivers: [1], sources: [{ type: "exhibit", ref: "1", label: "Revenue" }] }]);
    const rex = await db.select().from(exhibits).where(eq(exhibits.driverId, `${SYMBOL}:rationale`));
    expect(rex.map((e) => [e.id, e.number, e.series.map((s) => s.key)])).toEqual([[`${SYMBOL}:rationale:1`, 3, ["line:revenue"]]]);
    // Same inputs: never asked again.
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["analysis", "rationale", "report"]);
  });

  it("Thierry's own fair value wins, Claude's is kept beside it", async () => {
    await db.update(theses).set({ fairValue: 45000, fairValueBasis: "his model", currency: "KRW" }).where(eq(theses.symbol, SYMBOL));
    await runDimension(db, analysis, { trigger: "test", ctx: ctx() });
    const [fv] = await db.select().from(fairValues).where(eq(fairValues.symbol, SYMBOL));
    expect(fv).toMatchObject({ value: 45000, method: "his model", author: "thierry", claudeValue: 40000 });
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
    expect(calls).toEqual(["evidence", "evidence"]);
    const all = await db.select().from(evidence);
    expect(all).toHaveLength(1);
    const [e] = all;
    // One verdict per driver; the item's top line is its strongest verdict.
    expect(e.verdicts.map((v) => [v.driverId, v.effect, v.strength])).toEqual([[`${SYMBOL}:1`, "noise", "noise"], [`${SYMBOL}:2`, "reversal", "strong"]]);
    expect(e).toMatchObject({ id: `${SYMBOL}|filing:${filingId}`, headline: "Share buyback trust", filingIds: [filingId], driverId: `${SYMBOL}:2`, effect: "reversal", strength: "strong", exhibitId: `${SYMBOL}:2:1` });

    calls = [];
    await runDimension(db, narrativeStateDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual(["driver-state", "driver-state", "ticker-state"]);
    const states = await db.select().from(narrativeStates);
    expect(Object.fromEntries(states.map((x) => [x.id, `${x.level} ${x.effect}:${x.strength}`]))).toEqual({ [`${SYMBOL}:1`]: "driver noise:noise", [`${SYMBOL}:2`]: "driver reversal:strong", [SYMBOL]: "ticker reversal:weak" });
    expect(states.find((x) => x.id === `${SYMBOL}:2`)?.evidenceIds).toEqual([e.id]);
    // Same inputs: never asked again.
    calls = [];
    await runDimension(db, narrativeStateDim, { trigger: "test", ctx: ctx() });
    expect(calls).toEqual([]);

    await runDimension(db, signalsDim, { trigger: "test", ctx: ctx() });
    const [s] = await db.select().from(signals).where(eq(signals.symbol, SYMBOL));
    expect(s).toMatchObject({ signal: "BUY", strength: "weak", fairValue: 40000, quote: 30000, evidenceIds: [e.id] });
    expect(s.gapPct).toBeCloseTo(-0.25, 6);
    const [change] = await db.select().from(signalChanges);
    expect(change).toMatchObject({ symbol: SYMBOL, fromSignal: "none", toSignal: "BUY", toStrength: "weak", updateNote: expect.stringContaining("BUY") });
  });

  it("asks for drivers that SUPPORT the narrative, never one against it", () => {
    const p = analysisPrompt("facts");
    expect(p).toContain("Every driver SUPPORTS the narrative");
    expect(p).not.toMatch(/weakens/);
  });
});

describe("signal rule", () => {
  const fv = { value: 100, currency: "USD", method: "m" };
  const q = (close: number) => ({ close, currency: "USD", date: "2026-11-04" });
  const st = (effect: "reversal" | "continuation" | "noise", strength: "strong" | "weak" | "noise") => ({ effect, strength, evidenceIds: ["a"] });
  it("the narrative in reversal: BUY below fair value, SELL above; strength = the narrative's", () => {
    expect(computeSignal(fv, q(80), st("reversal", "strong"))).toMatchObject({ signal: "BUY", strength: "strong", evidenceIds: ["a"] });
    expect(computeSignal(fv, q(120), st("reversal", "weak"))).toMatchObject({ signal: "SELL", strength: "weak" });
  });
  it("continuation, noise, no state or another currency: no signal", () => {
    expect(computeSignal(fv, q(80), st("continuation", "strong")).signal).toBe("none");
    expect(computeSignal(fv, q(80), st("noise", "noise")).signal).toBe("none");
    expect(computeSignal(fv, q(80), null).signal).toBe("none");
    expect(computeSignal(fv, { close: 80, currency: "EUR", date: "x" }, st("reversal", "strong"))).toMatchObject({ signal: "none", gapPct: null });
  });
  it("subject grammar and verdict order", () => {
    expect(parseEvidenceSubject("101160.KQ|news:abc-1#2")).toEqual({ symbol: "101160.KQ", kind: "news", id: "abc-1", rank: 2 });
    const order = (["continuation:weak", "reversal:weak", "noise:noise", "continuation:strong", "reversal:strong"] as const).map((t) => t.split(":") as [string, string]);
    expect([...order].sort((a, b) => verdictRank({ effect: a[0] as never, strength: a[1] as never }) - verdictRank({ effect: b[0] as never, strength: b[1] as never })).map((x) => x.join(":"))).toEqual(["reversal:strong", "continuation:strong", "reversal:weak", "continuation:weak", "noise:noise"]);
  });
});
