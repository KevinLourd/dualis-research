import type { MethodResult, MethodWeight, PeerPricing, ValuationAssumption, ValuationMethodId } from "@/db/schema/valuation";
import { firstJsonObject } from "@/llm/judge";
import { stripDashes } from "../thesis/structure";
import { FACT_LABEL, peerMedian, peerPriced, bridgeTotal, type MethodSpec, type ValuationFacts } from "./methods";

/** Bump when a prompt or the arithmetic changes meaning: every method and synthesis is asked again. */
export const VALUATION_VERSION = "valuation@v5";

const f2 = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export const METHOD_SYSTEM = [
  "You are the valuation analyst of a small-cap long/short fund. For ONE valuation method you pick the assumptions of three scenarios (low, base, high); the code does the arithmetic from the reported figures and shows the result beside your text.",
  "Anchor every assumption on the facts given (the company's own history, its peers, its reported figures) and say where it comes from. Never invent a figure. Ratios as decimals (0.09 = 9%).",
  "A multiple method is priced the way the fund's analyst does it: the low case on the company's own history; base and high on what its listed peers trade at, with a premium or a discount. Set that premium or discount from how the company compares: smaller than the peers deserves less, faster growth and higher margins deserve more, a better or worse business (quality, balance sheet, cyclicality) moves it. Name those comparisons in the why. There is no fixed size discount: judge it from the figures.",
  "Plain English, short sentences. No rating, no time horizon, no price target. No em dash, no en dash. Answer with JSON only, no prose, no code fence.",
].join(" ");

/** Today's level of the method's own measure, when the facts allow it (the model reads its history against it). */
function today(spec: MethodSpec, f: ValuationFacts): string | null {
  const q = f.quote?.price;
  const i = (k: keyof typeof FACT_LABEL) => f.inputs[k]?.value ?? null;
  if (!q) return null;
  const shares = i("shares");
  if (spec.id === "ev-ebitda" && shares && i("ebitda")! > 0 && i("net-debt") !== null) return `EV/EBITDA today: ${((q * shares + bridgeTotal(f)) / i("ebitda")!).toFixed(1)}x`;
  if (spec.id === "pe" && i("eps-trailing")! > 0) return `P/E today on last year's EPS: ${(q / i("eps-trailing")!).toFixed(1)}x`;
  if (spec.id === "pb" && shares && i("equity")! > 0) return `P/B today: ${(q / (i("equity")! / shares)).toFixed(2)}x`;
  if (spec.id === "dividend-yield" && shares && i("dividends")! > 0) return `Dividend yield today: ${((i("dividends")! / shares / q) * 100).toFixed(2)}%`;
  return null;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const mult = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${x.toFixed(1)}x`);

/** The peer block of a multiple method: the company beside each peer (size, growth, margins, multiples), and each median. */
function peerBlock(spec: MethodSpec, f: ValuationFacts): string[] {
  if (!spec.peerMultiple) return [];
  const ids = spec.bases?.map((b) => b.id) ?? [null];
  const medians = ids.map((b) => ({ b, m: peerMedian(spec, f, b) }));
  const own = f.own;
  const lines = [
    "",
    `The company: market cap ${own?.marketCap ? `${f2(own.marketCap)} ${f.currency ?? ""}` : "n/a"}, revenue growth last fiscal year ${pct(own?.revenueGrowth)}, EBITDA margin ${pct(own?.ebitdaMargin)}, net margin ${pct(own?.netMargin)}.`,
    f.peers.length ? "Listed peers today (Yahoo; market cap in each peer's own currency):" : "Listed peers: none collected.",
    ...f.peers.map((p) => `- ${p.name ?? p.symbol} (${p.symbol}): EV/EBITDA ${mult(p.evEbitda)}, P/E ${mult(p.pe)}, forward P/E ${mult(p.peForward)}, P/B ${mult(p.pb)}; market cap ${p.marketCap ? `${f2(p.marketCap)} ${p.currency ?? ""}` : "n/a"}, revenue growth ${pct(p.revenueGrowth)}, EBITDA margin ${pct(p.ebitdaMargin)}`),
    ...medians.map(({ b, m }) => (m ? `Peers' median ${m.label}${b ? ` (basis ${b})` : ""}: ${m.median.toFixed(2)}x over ${m.count} peer${m.count === 1 ? "" : "s"}.` : `Peers' median${b ? ` for basis ${b}` : ""}: no peer carries this multiple.`)),
  ];
  return lines;
}

export function methodPrompt(spec: MethodSpec, f: ValuationFacts, context: string): string {
  const inputs = Object.values(f.inputs).map((x) => `- ${x!.label}: ${f2(x!.value)} (${x!.period}; ${x!.sources.join(", ") || "gold"})`);
  const h = spec.history ? f.history[spec.history.key] : undefined;
  const now = today(spec, f);
  return [
    `Company: ${f.name ?? f.symbol} (${f.symbol}). Reporting currency ${f.currency ?? "unknown"}.`,
    context,
    f.quote ? `Quote: ${f2(f.quote.price)} ${f.currency ?? ""} on ${f.quote.date}.` : "Quote: in another currency than the statements (no comparison).",
    "",
    `Method: ${spec.name}. ${spec.description}`,
    "Reported figures available:",
    ...inputs,
    h?.length ? `${spec.history!.label}: ${h.map((p) => `${p.period} ${f2(p.value)}`).join("; ")} (min ${f2(Math.min(...h.map((p) => p.value)))}, median ${f2(median(h.map((p) => p.value)))}, max ${f2(Math.max(...h.map((p) => p.value)))})` : spec.history ? `${spec.history.label}: no history collected.` : null,
    now,
    ...peerBlock(spec, f),
    spec.bases ? `Bases you can run it on (pick one): ${bases(spec, f).map((b) => `${b.id} = ${b.label}${f.inputs[b.id === "forward" ? "eps-forward" : b.id === "last" ? "fcf-last" : b.id === "average" ? "fcf-average" : "ebitda"] ? "" : " (not collected)"}`).join("; ")}.` : null,
    "",
    "JSON:",
    "{",
    '  "applicable": true | false,',
    '  "reason": "<only when false: one sentence why this method does not fit this company>",',
    spec.bases ? `  "basis": ${bases(spec, f).map((b) => JSON.stringify(b.id)).join(" | ")},` : null,
    ...assumptionJson(spec, f),
    '  "summary": "<ONE sentence: what this method says about the company, no per-share value (the code computes it)>",',
    '  "report": "<markdown, 120 to 250 words: what the method measures here, each assumption and why, what would move the value; no per-share value>"',
    "}",
    "low = the cautious case, high = the generous case.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/**
 * The bases offered: for a multiple priced off peers, only those with a peers' median (2026-11-09: P/E run on a basis
 * no peer carried came back with no base and high).
 */
function bases(spec: MethodSpec, f: ValuationFacts): NonNullable<MethodSpec["bases"]> {
  const all = spec.bases ?? [];
  if (!spec.peerMultiple) return all;
  // A basis is offered when a peer carries its multiple AND the company has the figure it multiplies.
  const peered = all.filter((b) => peerMedian(spec, f, b.id) && spec.uses(f, b.id).every((k) => (f.inputs[k]?.value ?? 0) > 0));
  return peered.length ? peered : all;
}

/** The JSON lines asking for the assumptions: a multiple with peers = low from own history + a premium for base and high. */
function assumptionJson(spec: MethodSpec, f: ValuationFacts): string[] {
  const peered = spec.peerMultiple && (spec.bases?.map((b) => b.id) ?? [null]).some((b) => peerMedian(spec, f, b));
  if (!peered) return [`  "assumptions": {${spec.assumptions.map((a) => `"${a.key}": {"low": <${a.unit === "ratio" ? "decimal" : "multiple"}>, "base": <...>, "high": <...>, "why": "<one sentence: where these numbers come from>"}`).join(", ")}},`];
  return [
    `  "assumptions": {"multiple": {"low": <the cautious multiple read on the company's own history>, "base": <only if the basis you pick has no peers' median>, "high": <same>, "why": "<one sentence: where the low comes from in its history>"}},`,
    '  "peers": {"base": <premium (+) or discount (-) to the peers\' median, decimal>, "high": <the generous one, decimal>, "why": "<one or two sentences: how the company compares with the peers on size, growth, margins and quality, and so why this premium or discount>"},',
  ];
}

const isStr = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

export type MethodAnswer = { applicable: boolean; reason: string | null; basis: string | null; assumptions: ValuationAssumption[]; peerPricing: PeerPricing; summary: string | null; report: string | null };

export function parseMethodAnswer(text: string, spec: MethodSpec, f: ValuationFacts): MethodAnswer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (o.applicable === false) return { applicable: false, reason: isStr(o.reason) ? stripDashes(o.reason) : "Judged not to fit this company.", basis: null, assumptions: [], peerPricing: null, summary: null, report: null };
  const offered = bases(spec, f);
  const basis = spec.bases ? (offered.find((b) => b.id === o.basis)?.id ?? offered[0].id) : null;
  const median = peerMedian(spec, f, basis);
  const a = (o.assumptions ?? {}) as Record<string, Record<string, unknown>>;
  const why = (x: unknown) => (isStr(x) ? stripDashes(x) : "");
  let peerPricing: PeerPricing = null;
  const assumptions: ValuationAssumption[] = spec.assumptions.map((s) => {
    const x = a[s.key];
    // A missing value is NaN, never 0 (Number(null) = 0 put P/E base and high at 0 on 2026-11-09).
    const n = (k: string) => (typeof x?.[k] === "number" ? (x[k] as number) : Number.NaN);
    if (median && s.key === "multiple") {
      const p = (o.peers ?? {}) as Record<string, unknown>;
      const premium = { base: typeof p.base === "number" ? p.base : Number.NaN, high: typeof p.high === "number" ? p.high : Number.NaN };
      if (!x || !Number.isFinite(n("low")) || !Number.isFinite(premium.base) || !Number.isFinite(premium.high)) throw new Error(`${spec.id}: needs the own-history low multiple and the peers' base and high premium`);
      const priced = peerPriced(median.median, premium);
      peerPricing = { multiple: median.id, label: median.label, median: median.median, count: median.count, premium, why: why(p.why) };
      return { key: s.key, label: s.label, unit: s.unit, low: n("low"), base: priced.base, high: priced.high, why: why(x.why) };
    }
    if (!x || ![n("low"), n("base"), n("high")].every(Number.isFinite)) throw new Error(`${spec.id}: assumption "${s.key}" needs low, base and high numbers`);
    return { key: s.key, label: s.label, unit: s.unit, low: n("low"), base: n("base"), high: n("high"), why: why(x.why) };
  });
  if (peerPricing) {
    const pp = peerPricing as NonNullable<PeerPricing>;
    const low = assumptions.find((x) => x.key === "multiple")!.low;
    assumptions.push({ key: "peer-premium", label: `Versus peers' median ${pp.label} (${pp.median.toFixed(1)}x)`, unit: "ratio", low: low / pp.median - 1, base: pp.premium.base, high: pp.premium.high, why: pp.why });
  }
  return { applicable: true, reason: null, basis, assumptions, peerPricing, summary: isStr(o.summary) ? stripDashes(o.summary) : null, report: isStr(o.report) ? stripDashes(o.report) : null };
}

export const SYNTHESIS_SYSTEM = [
  "You are the head of research of a small-cap long/short fund. Several valuation methods were run on one company; you weigh them into one fair value and range, the way a sell-side football field is read.",
  "Weight a method by how well it fits this business and how reliable its inputs are (a cyclical: through-the-cycle multiples; an asset-heavy holding: book and net cash; a cash generator: DCF and earnings). Plain English. No rating, no time horizon. No em dash, no en dash. JSON only, no prose, no code fence.",
].join(" ");

const fmtValue = (v: number | null) => (v === null ? "n/a" : f2(v));

export function weightsPrompt(f: ValuationFacts, context: string, methods: { id: ValuationMethodId; name: string; r: MethodResult }[]): string {
  return [
    `Company: ${f.name ?? f.symbol} (${f.symbol}), values per share in ${f.currency ?? "?"}.`,
    context,
    f.quote ? `Quote: ${f2(f.quote.price)} on ${f.quote.date}.` : "Quote: in another currency.",
    "",
    "Methods run (value per share low / base / high):",
    ...methods.map((m) => `- ${m.id} (${m.name}): ${fmtValue(m.r.low)} / ${fmtValue(m.r.base)} / ${fmtValue(m.r.high)}${m.r.basis ? `, basis ${m.r.basis}` : ""}. ${m.r.summary ?? ""}`),
    "",
    `JSON: {"weights": {${methods.map((m) => `"${m.id}": {"weight": <0 to 100>, "why": "<one sentence>"}`).join(", ")}}, "label": "<the method mix in a few words, e.g. Mostly EV/EBITDA and DCF>"}`,
    "A method you do not trust here gets 0 with its why. Weights need not sum to 100 (the code normalises them).",
  ].join("\n");
}

export function parseWeights(text: string, ids: ValuationMethodId[]): { weights: MethodWeight[]; label: string } {
  const o = JSON.parse(firstJsonObject(text)) as { weights?: Record<string, { weight?: unknown; why?: unknown }>; label?: unknown };
  const weights = ids.map((id) => {
    const w = Number(o.weights?.[id]?.weight);
    if (!Number.isFinite(w) || w < 0) throw new Error(`synthesis: no weight for "${id}"`);
    return { method: id, weight: w, why: isStr(o.weights?.[id]?.why) ? stripDashes(String(o.weights![id].why)) : "" };
  });
  if (!weights.some((w) => w.weight > 0)) throw new Error("synthesis: every weight is zero");
  return { weights, label: isStr(o.label) ? stripDashes(o.label) : "Weighted methods" };
}

export function reportPrompt(f: ValuationFacts, context: string, methods: { id: ValuationMethodId; name: string; r: MethodResult; weight: number; why: string }[], result: { low: number; base: number; high: number }): string {
  return [
    `Company: ${f.name ?? f.symbol} (${f.symbol}), values per share in ${f.currency ?? "?"}.`,
    context,
    f.quote ? `Quote: ${f2(f.quote.price)} on ${f.quote.date}.` : "Quote: in another currency.",
    `Fair value (weighted by the code): ${f2(result.base)}, range ${f2(result.low)} to ${f2(result.high)}.`,
    "",
    "Each method, its weight and its own report:",
    ...methods.map((m) => [`### ${m.name}: ${fmtValue(m.r.low)} / ${fmtValue(m.r.base)} / ${fmtValue(m.r.high)}, weight ${(m.weight * 100).toFixed(0)}% (${m.why})`, m.r.report ?? m.r.summary ?? ""].join("\n")),
    "",
    'JSON: {"summary": "<ONE sentence: the fair value, the range and what it rests on>", "report": "<markdown, 400 to 700 words, sections as ## headings: Conclusion, Methods, Weights, What would change the value. Figures only as given above.>"}',
  ].join("\n");
}

export function parseReport(text: string): { summary: string; report: string } {
  const o = JSON.parse(firstJsonObject(text)) as { summary?: unknown; report?: unknown };
  if (!isStr(o.summary) || !isStr(o.report)) throw new Error("synthesis: no summary or report");
  return { summary: stripDashes(o.summary), report: stripDashes(o.report) };
}
