import { and, eq, inArray } from "drizzle-orm";
import { fairValues } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import { goldFinancialLines } from "@/db/schema/financials";
import * as gold from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
import {
  analystTargets,
  goldMethodValuations,
  methodValuations,
  peers as goldPeers,
  valuationMethods,
  valuationReports,
  valuationSyntheses,
  type MethodResult,
  type SynthesisResult,
  type ValuationMethodId,
} from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { analysedSymbols } from "../watchlist";
import { bookValueJudgment } from "./book-value";
import { targetsIn, valuationFacts } from "./facts";
import { dataAsOf, historyOf, methodSpec, runScenarios, VALUATION_METHODS, weighted, type MethodSpec, type ValuationFacts } from "./methods";
import { METHOD_SYSTEM, SYNTHESIS_SYSTEM, VALUATION_VERSION, methodPrompt, parseMethodAnswer, parseReport, parseWeights, reportPrompt, weightsPrompt } from "./prompt";

export { VALUATION_METHODS } from "./methods";
export const VALUATION_DIMENSION = "valuation";
const PARALLEL = 3;

type MethodOut = { method: ValuationMethodId; inputHash: string; result?: MethodResult; model?: string | null; reusedId?: string };
type SynthesisOut = { inputHash: string; result?: SynthesisResult; model?: string | null; reusedId?: string };
export type ValuationPayload = { methods: MethodOut[]; synthesis: SynthesisOut | null };

const round = (v: number | null) => (v === null ? null : Number(v.toPrecision(4)));

/** A method that cannot run: its row says why, no LLM call. */
const notApplicable = (spec: MethodSpec, f: ValuationFacts, reason: string): MethodResult => ({
  applicable: false,
  reason,
  currency: f.currency,
  low: null,
  base: null,
  high: null,
  basis: null,
  assumptions: [],
  steps: [],
  inputs: [],
  history: historyOf(spec, f),
  peers: [],
  peerPricing: null,
  summary: null,
  report: null,
});

/** Analyst price targets: read as published, no assumption. */
function targetsResult(f: ValuationFacts): MethodResult {
  const t = f.targets!;
  return {
    applicable: true,
    reason: null,
    currency: f.currency,
    low: t.low,
    base: t.mean,
    high: t.high,
    basis: null,
    assumptions: [],
    steps: [
      { label: "Lowest target", unit: "per-share", low: t.low, base: t.low, high: t.low },
      { label: "Mean target", unit: "per-share", low: t.mean, base: t.mean, high: t.mean },
      { label: "Highest target", unit: "per-share", low: t.high, base: t.high, high: t.high },
    ],
    inputs: [{ key: "targets", label: `Analyst price targets${t.analysts ? `, ${t.analysts} analysts` : ""}`, value: t.mean, unit: "per-share", period: "today", sources: t.sources }],
    history: null,
    peers: [],
    peerPricing: null,
    summary: `${t.analysts ?? "Some"} analyst${t.analysts === 1 ? "" : "s"} publish a 12-month target between ${t.low} and ${t.high}, mean ${t.mean}.`,
    report: null,
  };
}

async function methodResult(spec: MethodSpec, f: ValuationFacts, context: string, ctx: SourceContext): Promise<{ result: MethodResult; model: string | null }> {
  const na = spec.notApplicable(f);
  if (na) return { result: notApplicable(spec, f, na), model: null };
  if (spec.id === "analyst-targets") return { result: targetsResult(f), model: null };
  if (!ctx.complete) throw new Error("valuation: no LLM in the collector context (cli.ts sets ctx.complete)");
  const r = await ctx.complete({ system: METHOD_SYSTEM, prompt: methodPrompt(spec, f, context) });
  const a = parseMethodAnswer(r.text, spec, f);
  if (!a.applicable) return { result: notApplicable(spec, f, a.reason!), model: r.model };
  const scen = (s: "low" | "base" | "high") => Object.fromEntries(a.assumptions.map((x) => [x.key, x[s]]));
  const run = runScenarios(spec, f, { low: scen("low"), base: scen("base"), high: scen("high") }, a.basis);
  const used = new Set(spec.uses(f, a.basis));
  return {
    result: {
      applicable: true,
      reason: null,
      currency: f.currency,
      low: run.low,
      base: run.base,
      high: run.high,
      basis: a.basis,
      assumptions: a.assumptions,
      steps: run.steps,
      inputs: Object.values(f.inputs).filter((x) => used.has(x!.key as never)) as MethodResult["inputs"],
      history: historyOf(spec, f),
      peers: spec.peerMultiple ? f.peers : [],
      peerPricing: a.peerPricing,
      summary: a.summary,
      report: a.report,
    },
    model: r.model,
  };
}

export const valuationSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: PARALLEL,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("valuation: needs the database");
    const db = ctx.db;
    const [peerRows, [target], [profile], [ticker]] = await Promise.all([
      db.select().from(goldPeers).where(eq(goldPeers.symbol, symbol)),
      db.select().from(analystTargets).where(eq(analystTargets.symbol, symbol)),
      db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)),
      db.select().from(gold.tickers).where(eq(gold.tickers.symbol, symbol)),
    ]);
    if (!ctx.complete) throw new Error("valuation: no LLM in the collector context (cli.ts sets ctx.complete)");
    const [base, bookValue] = await Promise.all([valuationFacts(db, symbol, { peers: [], targets: null }), bookValueJudgment(db, symbol, profile, ctx.complete)]);
    const f: ValuationFacts = {
      bookValue,
      ...base,
      peers: peerRows.map((p) => ({ symbol: p.peerSymbol, name: p.name, currency: p.currency, evEbitda: p.evEbitda, pe: p.pe, peForward: p.peForward, pb: p.pb, marketCap: p.marketCap, revenueGrowth: p.revenueGrowth, ebitdaMargin: p.ebitdaMargin, sources: p.sources })),
      targets: target ? targetsIn(base.currency, { low: target.low, mean: target.mean, high: target.high, analysts: target.analysts, currency: target.currency, sources: target.sources }) : null,
    };
    const context = [`Business: ${[profile?.sector, profile?.industry].filter(Boolean).join(" / ") || "unknown"}. ${profile?.description?.slice(0, 500) ?? ""}`, `Analyst position: ${ticker?.position ?? "watch"}.`].join("\n");
    const bucket = marketBucket(f.quote?.price ?? null);
    const factsHash = valuationFactsHash(f, bucket, context);

    // The 8 methods at once (Kevin 2026-11-06 « speeder »): each reads the same facts, none reads another.
    const done = await Promise.all(
      VALUATION_METHODS.map(async (spec) => {
        const inputHash = fnv(`${spec.id}\n${factsHash}`);
        const [prior] = await db.select({ id: methodValuations.id, result: methodValuations.result }).from(methodValuations).where(and(eq(methodValuations.symbol, symbol), eq(methodValuations.method, spec.id), eq(methodValuations.inputHash, inputHash))).limit(1);
        if (prior) return { out: { method: spec.id, inputHash, reusedId: prior.id } as MethodOut, r: { id: spec.id, name: spec.name, r: prior.result } };
        const { result, model } = await methodResult(spec, f, context, ctx);
        return { out: { method: spec.id, inputHash, result, model } as MethodOut, r: { id: spec.id, name: spec.name, r: result } };
      }),
    );
    const methods: MethodOut[] = done.map((x) => x.out);
    const results: { id: ValuationMethodId; name: string; r: MethodResult }[] = done.map((x) => x.r);

    const live = results.filter((x) => x.r.applicable && x.r.base !== null);
    if (live.length === 0) return { request: { symbol, factsHash }, httpStatus: null, payload: { methods, synthesis: null } satisfies ValuationPayload };
    const synthHash = fnv(JSON.stringify({ v: VALUATION_VERSION, m: live.map((x) => [x.id, round(x.r.low), round(x.r.base), round(x.r.high)]), bucket }));
    const [prior] = await db.select({ id: valuationSyntheses.id }).from(valuationSyntheses).where(and(eq(valuationSyntheses.symbol, symbol), eq(valuationSyntheses.inputHash, synthHash))).limit(1);
    if (prior) return { request: { symbol, factsHash }, httpStatus: null, payload: { methods, synthesis: { inputHash: synthHash, reusedId: prior.id } } satisfies ValuationPayload };
    if (!ctx.complete) throw new Error("valuation: no LLM in the collector context (cli.ts sets ctx.complete)");
    const w = await ctx.complete({ system: SYNTHESIS_SYSTEM, prompt: weightsPrompt(f, context, live) });
    const { weights, label } = parseWeights(w.text, live.map((x) => x.id));
    const value = weighted(
      live.map((x) => ({ method: x.id, low: x.r.low!, base: x.r.base!, high: x.r.high! })),
      Object.fromEntries(weights.map((x) => [x.method, x.weight])),
    );
    const normal = weights.map((x) => ({ ...x, weight: value.weights[x.method] ?? 0 }));
    const rep = await ctx.complete({ system: SYNTHESIS_SYSTEM, prompt: reportPrompt(f, context, live.map((x) => ({ ...x, weight: value.weights[x.id] ?? 0, why: normal.find((n) => n.method === x.id)!.why })), value) });
    const { summary, report } = parseReport(rep.text);
    const result: SynthesisResult = { currency: f.currency, low: value.low, base: value.base, high: value.high, weights: normal, label, summary, report };
    return { request: { symbol, factsHash }, httpStatus: null, payload: { methods, synthesis: { inputHash: synthHash, result, model: w.model } } satisfies ValuationPayload };
  },
};

/** Tickers with collected statements. */
async function subjects(db: Db): Promise<string[]> {
  const withLines = new Set((await db.selectDistinct({ symbol: goldFinancialLines.symbol }).from(goldFinancialLines).where(eq(goldFinancialLines.line, "revenue"))).map((r) => r.symbol));
  return (await analysedSymbols(db)).filter((s) => withLines.has(s));
}

/** A market-driven figure in 15% steps (log scale), the quote's rule: a price tick must not re-ask the methods. */
export function marketBucket(x: number | null | undefined): number | string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "none";
  return x > 0 ? Math.round(Math.log(x) / Math.log(1.15)) : "not-positive";
}

/**
 * The valuation's input hash. Reported figures and histories count exactly; what moves with every tick (peers' multiples
 * today, analyst targets, the forward EPS consensus) counts in 15% buckets, sources left out. Without it every run in
 * market hours re-asked Claude and the Fair Value swung (Water Oasis 1.37 -> 1.03 -> 1.61 HKD in 2 hours, 2026-11-06).
 */
export function valuationFactsHash(f: ValuationFacts, bucket: number | string, context: string): string {
  const inputs = Object.fromEntries(
    Object.entries(f.inputs).map(([k, i]) => [k, k === "eps-forward" ? { b: marketBucket(i!.value), period: i!.period } : { value: i!.value, period: i!.period }]),
  );
  const peers = [...f.peers]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((p) => [p.symbol, p.currency, ...[p.evEbitda, p.pe, p.peForward, p.pb, p.marketCap].map(marketBucket), ...[p.revenueGrowth, p.ebitdaMargin].map((x) => (x === null || x === undefined ? null : Math.round(x * 20)))]);
  const targets = f.targets ? [marketBucket(f.targets.low), marketBucket(f.targets.mean), marketBucket(f.targets.high), f.targets.currency] : null;
  const own = f.own ? [marketBucket(f.own.marketCap), ...[f.own.revenueGrowth, f.own.ebitdaMargin, f.own.netMargin].map((x) => (x === null ? null : Math.round(x * 100)))] : null;
  const bookValue = f.bookValue ? { drives: f.bookValue.drives, why: f.bookValue.why } : null;
  return fnv(JSON.stringify({ v: VALUATION_VERSION, inputs, history: f.history, peers, own, targets, bucket, context, bookValue }));
}

export const valuationDim: Dimension = {
  name: VALUATION_DIMENSION,
  description:
    "The fair value pyramid: every Valuation Method of the fixed list run on the ticker (Claude picks low / base / high assumptions with a why, the code computes from reported figures), then a synthesis that weighs them into the Fair Value, its range and the Valuation Report. Once per input hash.",
  sources: [valuationSource],
  subjects,
  promote: promoteValuation,
};

export async function promoteValuation(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of fetches.filter((x) => !x.error)) {
    const p = f.payload as ValuationPayload;
    for (const m of p.methods.filter((x) => x.result)) {
      await db.insert(methodValuations).values({ symbol: f.subject, method: m.method, inputHash: m.inputHash, result: m.result!, model: m.model ?? null, bronzeId: f.id, createdAt: f.fetchedAt });
      n++;
    }
    if (p.synthesis?.result) {
      await db.insert(valuationSyntheses).values({ symbol: f.subject, inputHash: p.synthesis.inputHash, result: p.synthesis.result, model: p.synthesis.model ?? null, bronzeId: f.id, createdAt: f.fetchedAt });
      n++;
    }
  }
  await rebuildValuationGold(db, fetches);
  return { silverRowsBySource: { claude: n } };
}

/** The current version of each method and synthesis = the one this run pointed at (new or reused), else the latest stored. */
export async function rebuildValuationGold(db: Db, fetches: BronzeFetch[] = []): Promise<void> {
  const symbols = await analysedSymbols(db);
  const pointed = new Map<string, string>();
  for (const f of fetches.filter((x) => !x.error)) {
    const p = f.payload as ValuationPayload;
    for (const m of p.methods) pointed.set(`${f.subject}|${m.method}`, m.inputHash);
    pointed.set(`${f.subject}|synthesis`, p.synthesis?.inputHash ?? "none");
  }
  // Egress budget (CLAUDE.md): the keys first, then only the rows gold keeps (silver is append-only and grows).
  const mvKeys = symbols.length ? await db.select({ id: methodValuations.id, symbol: methodValuations.symbol, method: methodValuations.method, inputHash: methodValuations.inputHash, createdAt: methodValuations.createdAt }).from(methodValuations).where(inArray(methodValuations.symbol, symbols)) : [];
  const syKeys = symbols.length ? await db.select({ id: valuationSyntheses.id, symbol: valuationSyntheses.symbol, inputHash: valuationSyntheses.inputHash, createdAt: valuationSyntheses.createdAt }).from(valuationSyntheses).where(inArray(valuationSyntheses.symbol, symbols)) : [];
  const pick = <T extends { symbol: string; inputHash: string; createdAt: Date }>(rows: T[], key: (r: T) => string): Map<string, T> => {
    const out = new Map<string, T>();
    for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const k = key(r);
      const want = pointed.get(k);
      if (want === undefined || want === r.inputHash) out.set(k, r);
    }
    for (const [k, h] of pointed) if (h === "none") out.delete(k);
    return out;
  };
  // Only methods of today's catalogue: "Listed peers" folded into the multiples on 2026-11-09, its old rows stay in silver.
  const catalogue = new Set<string>(VALUATION_METHODS.map((m) => m.id));
  const mIds = [...pick(mvKeys.filter((r) => catalogue.has(r.method)), (r) => `${r.symbol}|${r.method}`).values()].map((r) => r.id);
  const sIds = [...pick(syKeys, (r) => `${r.symbol}|synthesis`).values()].map((r) => r.id);
  const mv = mIds.length ? await db.select().from(methodValuations).where(inArray(methodValuations.id, mIds)) : [];
  const sy = sIds.length ? await db.select().from(valuationSyntheses).where(inArray(valuationSyntheses.id, sIds)) : [];
  const methods = new Map(mv.map((r) => [`${r.symbol}|${r.method}`, r]));
  const synth = new Map(sy.map((r) => [`${r.symbol}|synthesis`, r]));
  const thesisRows = new Map((await db.select().from(theses)).map((t) => [t.symbol, t]));
  const name = (id: ValuationMethodId) => (id === "peers" ? "Listed peers" : methodSpec(id).name);

  const mRows: (typeof goldMethodValuations.$inferInsert)[] = [...methods.values()].map((r) => ({
    id: `${r.symbol}:${r.method}`,
    symbol: r.symbol,
    method: r.method,
    applicable: r.result.applicable ? 1 : 0,
    reason: r.result.reason,
    currency: r.result.currency,
    low: r.result.low,
    base: r.result.base,
    high: r.result.high,
    basis: r.result.basis,
    assumptions: r.result.assumptions,
    steps: r.result.steps,
    inputs: r.result.inputs,
    history: r.result.history,
    peers: r.result.peers,
    peerPricing: r.result.peerPricing ?? null,
    summary: r.result.summary,
    report: r.result.report,
    dataAsOf: dataAsOf(r.result.inputs, r.createdAt),
    version: r.id,
    asOf: r.createdAt,
  }));
  const rRows: (typeof valuationReports.$inferInsert)[] = [];
  const fRows: (typeof fairValues.$inferInsert)[] = [];
  for (const symbol of symbols) {
    const s = synth.get(`${symbol}|synthesis`);
    const t = thesisRows.get(symbol);
    const thierry = t?.fairValue ?? null;
    const mix = s ? s.result.weights.filter((w) => w.weight > 0).sort((a, b) => b.weight - a.weight).map((w) => `${name(w.method)} ${Math.round(w.weight * 100)}%`).join(", ") : null;
    if (s) rRows.push({ symbol, currency: s.result.currency, low: s.result.low, base: s.result.base, high: s.result.high, weights: s.result.weights, label: s.result.label, summary: s.result.summary, markdown: s.result.report, version: s.id, asOf: s.createdAt });
    if (!s && thierry === null) continue;
    fRows.push({
      symbol,
      value: thierry ?? s!.result.base,
      currency: thierry !== null ? (t?.currency ?? s?.result.currency ?? null) : s!.result.currency,
      low: thierry !== null ? null : s!.result.low,
      high: thierry !== null ? null : s!.result.high,
      method: thierry !== null ? (t?.fairValueBasis ?? null) : mix,
      label: thierry !== null ? (t?.fairValueBasis ?? null) : s!.result.label,
      author: thierry !== null ? "thierry" : "claude",
      claudeValue: s?.result.base ?? null,
      claudeMethod: mix,
      inputs: s ? s.result.weights.filter((w) => w.weight > 0).map((w) => ({ label: `${name(w.method)} (${Math.round(w.weight * 100)}%)`, value: methods.get(`${symbol}|${w.method}`)?.result.base ?? 0, period: "base case" })) : [],
      version: s?.id ?? null,
      asOf: s?.createdAt ?? null,
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(valuationMethods);
    await tx.insert(valuationMethods).values(VALUATION_METHODS.map((m, i) => ({ id: m.id, rank: i + 1, name: m.name, family: m.family, description: m.description })));
    for (const table of [goldMethodValuations, valuationReports, fairValues]) await tx.delete(table);
    if (mRows.length) await tx.insert(goldMethodValuations).values(mRows);
    if (rRows.length) await tx.insert(valuationReports).values(rRows);
    if (fRows.length) await tx.insert(fairValues).values(fRows);
  });
}
