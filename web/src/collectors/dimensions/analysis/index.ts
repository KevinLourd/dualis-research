import { and, desc, eq, isNull } from "drizzle-orm";
import { fetches as bronze, type BronzeFetch } from "@/db/schema/bronze";
import { analyses, exhibits, narrativeDrivers, narrativeRationales, narratives, researchReports, type AnalysisAnswer, type RationaleAnswer } from "@/db/schema/analysis";
import { goldFinancialLines } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { analysedSymbols } from "../watchlist";
import { stripDashes } from "../thesis/structure";
import { fnv, gatherFacts } from "./facts";
import { ANALYSIS_SYSTEM, ANALYSIS_VERSION, RATIONALE_SYSTEM, REPORT_SYSTEM, analysisPrompt, parseAnalysis, parseRationale, rationalePrompt, reportPrompt } from "./prompt";
import { exhibitData, seriesCatalog, type StoredSeries } from "./series";

export const ANALYSIS_DIMENSION = "analysis";
const SOURCE = "claude";
const PARALLEL = 4;
export const DISCLAIMER = "This report is for information only and is not investment advice. Figures come from company filings and data providers as collected; check the sources before acting.";

export type AnalysisPayload = { version: string; inputHash: string; analysis: AnalysisAnswer; rationale: RationaleAnswer | null; report: string; model: string; quote: { close: number; date: string; currency: string | null } | null };

/** Keeps only exhibit series that exist in the stored catalogue with 2+ points; an exhibit left with none is dropped. */
export function bindExhibits(a: AnalysisAnswer, catalog: Map<string, StoredSeries>): { answer: AnalysisAnswer; unbound: number[] } {
  const drivers = a.drivers.map((d) => ({
    ...d,
    exhibits: d.exhibits.map((e) => ({ ...e, series: e.series.filter((k) => (catalog.get(k)?.points.size ?? 0) >= 2) })).filter((e) => e.series.length > 0 && e.title),
  }));
  return { answer: { ...a, drivers }, unbound: drivers.map((d, i) => (d.exhibits.length === 0 ? i + 1 : 0)).filter(Boolean) };
}

/** Exhibit numbers across the ticker, in driver order: what `[EXHIBIT n]` in the report points to. */
export const numberedExhibits = (a: AnalysisAnswer) => a.drivers.flatMap((d, di) => d.exhibits.map((e, ei) => ({ driver: di + 1, rank: ei + 1, ...e }))).map((e, i) => ({ ...e, number: i + 1 }));

export const analysisSource: Source = {
  name: SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: PARALLEL,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("analysis: needs the database");
    const facts = await gatherFacts(ctx.db, symbol);
    if (!facts.hasFinancials) return { request: { symbol }, httpStatus: null, error: "no financial statements collected for this ticker" };
    const inputHash = fnv(`${ANALYSIS_VERSION}\n${facts.hash}`);
    const [prior] = await ctx.db
      .select({ id: bronze.id, payload: bronze.payload })
      .from(bronze)
      .where(and(eq(bronze.dimension, ANALYSIS_DIMENSION), eq(bronze.subject, symbol), isNull(bronze.error)))
      .orderBy(desc(bronze.fetchedAt))
      .limit(1);
    if ((prior?.payload as AnalysisPayload | undefined)?.inputHash === inputHash) return { request: { inputHash, reusedFrom: prior.id }, httpStatus: null, payload: prior.payload };
    if (!ctx.complete) throw new Error("analysis: no LLM in the collector context (cli.ts sets ctx.complete)");

    const prompt = analysisPrompt(facts.text);
    const first = await ctx.complete({ system: ANALYSIS_SYSTEM, prompt });
    let { answer, unbound } = bindExhibits(parseAnalysis(first.text), facts.catalog);
    if (unbound.length) {
      // The chart contract: a driver's exhibit must name stored series. One more ask, quoting the miss.
      const again = await ctx.complete({ system: ANALYSIS_SYSTEM, prompt: `${prompt}\n\nYour previous answer:\n${first.text}\n\nDrivers ${unbound.join(", ")} had no exhibit with a series key from the stored chart series list. Answer again, same JSON, every exhibit series copied exactly from that list.` });
      ({ answer, unbound } = bindExhibits(parseAnalysis(again.text), facts.catalog));
      if (unbound.length) return { request: { inputHash }, httpStatus: null, payload: { answer: again.text }, error: `drivers ${unbound.join(", ")} have no exhibit drawn from stored series` };
    }
    const numbered = numberedExhibits(answer);
    // Narrative Rationale: why the market holds the story, every claim citing its sources; its charts bound like the drivers'.
    const r = await ctx.complete({ system: RATIONALE_SYSTEM, prompt: rationalePrompt(facts.text, answer, numbered) });
    const parsed = parseRationale(r.text, answer.drivers.length);
    const rationale: RationaleAnswer = { ...parsed, exhibits: parsed.exhibits.map((e) => ({ ...e, series: e.series.filter((k) => (facts.catalog.get(k)?.points.size ?? 0) >= 2) })).filter((e) => e.series.length > 0 && e.title) };
    const [profile] = await ctx.db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
    const report = await ctx.complete({ system: REPORT_SYSTEM, prompt: reportPrompt(facts.text, answer, numbered, profile?.name ?? symbol) });
    const payload: AnalysisPayload = { version: ANALYSIS_VERSION, inputHash, analysis: answer, rationale, report: stripDashes(report.text.trim()), model: first.model, quote: facts.quote };
    return { request: { inputHash, version: ANALYSIS_VERSION }, httpStatus: null, payload };
  },
};

/** Tickers with collected statements: the analysis needs reported numbers. */
async function subjects(db: Db): Promise<string[]> {
  const withLines = new Set((await db.selectDistinct({ symbol: goldFinancialLines.symbol }).from(goldFinancialLines).where(eq(goldFinancialLines.line, "revenue"))).map((r) => r.symbol));
  return (await analysedSymbols(db)).filter((s) => withLines.has(s));
}

export const analysis: Dimension = {
  name: ANALYSIS_DIMENSION,
  description:
    "Per ticker, from the reported numbers and the Fair Value of the valuation pyramid: the Narrative (why the price sits there), up to 3 Narrative Drivers each with Exhibits drawn from stored series, the Narrative Rationale and the Research Report. Once per input hash.",
  sources: [analysisSource],
  subjects,
  promote: promoteAnalysis,
};

export async function promoteAnalysis(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of fetches.filter((x) => !x.error && !(x.request as { reusedFrom?: string }).reusedFrom)) {
    const p = f.payload as AnalysisPayload;
    const [exists] = await db.select({ id: analyses.id }).from(analyses).where(and(eq(analyses.symbol, f.subject), eq(analyses.inputHash, p.inputHash)));
    if (exists) continue;
    await db.insert(analyses).values({ symbol: f.subject, inputHash: p.inputHash, analysis: p.analysis, rationale: p.rationale ?? null, report: p.report, model: p.model, bronzeId: f.id, quote: p.quote?.close ?? null, quoteDate: p.quote?.date ?? null, createdAt: f.fetchedAt });
    n++;
  }
  await rebuildAnalysisGold(db);
  return { silverRowsBySource: { [SOURCE]: n } };
}

/** Gold from the latest analysis per active ticker (the Fair Value is the `valuation` dimension's). */
export async function rebuildAnalysisGold(db: Db): Promise<void> {
  const symbols = await analysedSymbols(db);
  const latest = new Map<string, typeof analyses.$inferSelect>();
  for (const a of await db.select().from(analyses).orderBy(analyses.createdAt)) latest.set(a.symbol, a);
  const nar: (typeof narratives.$inferInsert)[] = [];
  const drv: (typeof narrativeDrivers.$inferInsert)[] = [];
  const exh: (typeof exhibits.$inferInsert)[] = [];
  const rep: (typeof researchReports.$inferInsert)[] = [];
  const rat: (typeof narrativeRationales.$inferInsert)[] = [];
  for (const symbol of symbols) {
    const a = latest.get(symbol);
    if (!a) continue;
    nar.push({ symbol, text: a.analysis.narrative, detail: a.analysis.narrativeDetail ?? null, version: a.id, asOf: a.createdAt });
    const catalog = await seriesCatalog(db, symbol);
    const exhibitIds: string[] = [];
    a.analysis.drivers.forEach((d, i) => drv.push({ id: `${symbol}:${i + 1}`, symbol, rank: i + 1, category: d.category, title: d.title, summary: d.summary ?? null, text: d.text, version: a.id }));
    for (const e of numberedExhibits(a.analysis)) {
      const data = exhibitData(catalog, e.series);
      if (!data) continue;
      const id = `${symbol}:${e.driver}:${e.rank}`;
      exhibitIds.push(id);
      exh.push({ id, symbol, driverId: `${symbol}:${e.driver}`, rank: e.rank, number: e.number, title: e.title, chart: e.chart, series: data.series, points: data.points, takeaway: e.takeaway, sources: data.sources });
    }
    if (a.rationale) {
      const first = numberedExhibits(a.analysis).length;
      const ids: string[] = [];
      a.rationale.exhibits.forEach((e, i) => {
        const data = exhibitData(catalog, e.series);
        if (!data) return;
        const id = `${symbol}:rationale:${i + 1}`;
        ids.push(id);
        exh.push({ id, symbol, driverId: `${symbol}:rationale`, rank: i + 1, number: first + i + 1, title: e.title, chart: e.chart, series: data.series, points: data.points, takeaway: e.takeaway, sources: data.sources });
      });
      rat.push({ symbol, summary: a.rationale.summary, claims: a.rationale.claims, exhibitIds: ids, version: a.id, asOf: a.createdAt });
    }
    const [profile] = await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
    rep.push({ symbol, title: `${profile?.name ?? symbol} (${symbol}): Research Report`, markdown: `${a.report}\n\n_${DISCLAIMER}_`, exhibitIds, version: a.id, asOf: a.createdAt, model: a.model });
  }
  await db.transaction(async (tx) => {
    for (const table of [narratives, narrativeDrivers, exhibits, researchReports, narrativeRationales]) await tx.delete(table);
    if (nar.length) await tx.insert(narratives).values(nar);
    if (drv.length) await tx.insert(narrativeDrivers).values(drv);
    if (exh.length) await tx.insert(exhibits).values(exh);
    if (rep.length) await tx.insert(researchReports).values(rep);
    if (rat.length) await tx.insert(narrativeRationales).values(rat);
  });
}
