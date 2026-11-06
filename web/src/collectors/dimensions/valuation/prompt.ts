import type { MethodResult, MethodWeight, ValuationAssumption, ValuationMethodId } from "@/db/schema/valuation";
import { firstJsonObject } from "@/llm/judge";
import { stripDashes } from "../thesis/structure";
import { FACT_LABEL, type MethodSpec, type ValuationFacts } from "./methods";

/** Bump when a prompt or the arithmetic changes meaning: every method and synthesis is asked again. */
export const VALUATION_VERSION = "valuation@v1";

const f2 = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export const METHOD_SYSTEM = [
  "You are the valuation analyst of a small-cap long/short fund. For ONE valuation method you pick the assumptions of three scenarios (low, base, high); the code does the arithmetic from the reported figures and shows the result beside your text.",
  "Anchor every assumption on the facts given (the company's own history, its peers, its reported figures) and say where it comes from. Never invent a figure. Ratios as decimals (0.09 = 9%).",
  "Plain English, short sentences. No rating, no time horizon, no price target. No em dash, no en dash. Answer with JSON only, no prose, no code fence.",
].join(" ");

/** Today's level of the method's own measure, when the facts allow it (the model reads its history against it). */
function today(spec: MethodSpec, f: ValuationFacts): string | null {
  const q = f.quote?.price;
  const i = (k: keyof typeof FACT_LABEL) => f.inputs[k]?.value ?? null;
  if (!q) return null;
  const shares = i("shares");
  if (spec.id === "ev-ebitda" && shares && i("ebitda")! > 0 && i("net-debt") !== null) return `EV/EBITDA today: ${((q * shares + i("net-debt")!) / i("ebitda")!).toFixed(1)}x`;
  if (spec.id === "pe" && i("eps-trailing")! > 0) return `P/E today on last year's EPS: ${(q / i("eps-trailing")!).toFixed(1)}x`;
  if (spec.id === "pb" && shares && i("equity")! > 0) return `P/B today: ${(q / (i("equity")! / shares)).toFixed(2)}x`;
  if (spec.id === "dividend-yield" && shares && i("dividends")! > 0) return `Dividend yield today: ${((i("dividends")! / shares / q) * 100).toFixed(2)}%`;
  return null;
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
    spec.id === "peers" ? `Comparable companies today:\n${f.peers.map((p) => `- ${p.name ?? p.symbol} (${p.symbol}): EV/EBITDA ${p.evEbitda?.toFixed(1) ?? "n/a"}x, P/E ${p.pe?.toFixed(1) ?? "n/a"}x`).join("\n")}` : null,
    spec.bases ? `Bases you can run it on (pick one): ${spec.bases.map((b) => `${b.id} = ${b.label}${f.inputs[b.id === "forward" ? "eps-forward" : b.id === "last" ? "fcf-last" : b.id === "average" ? "fcf-average" : b.id === "pe" ? "eps-trailing" : "ebitda"] ? "" : " (not collected)"}`).join("; ")}.` : null,
    "",
    "JSON:",
    "{",
    '  "applicable": true | false,',
    '  "reason": "<only when false: one sentence why this method does not fit this company>",',
    spec.bases ? `  "basis": ${spec.bases.map((b) => JSON.stringify(b.id)).join(" | ")},` : null,
    `  "assumptions": {${spec.assumptions.map((a) => `"${a.key}": {"low": <${a.unit === "ratio" ? "decimal" : "multiple"}>, "base": <...>, "high": <...>, "why": "<one sentence: where these numbers come from>"}`).join(", ")}},`,
    '  "summary": "<ONE sentence: what this method says about the company, no per-share value (the code computes it)>",',
    '  "report": "<markdown, 120 to 250 words: what the method measures here, each assumption and why, what would move the value; no per-share value>"',
    "}",
    "low = the cautious case, high = the generous case.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

const isStr = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

export type MethodAnswer = { applicable: boolean; reason: string | null; basis: string | null; assumptions: ValuationAssumption[]; summary: string | null; report: string | null };

export function parseMethodAnswer(text: string, spec: MethodSpec): MethodAnswer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (o.applicable === false) return { applicable: false, reason: isStr(o.reason) ? stripDashes(o.reason) : "Judged not to fit this company.", basis: null, assumptions: [], summary: null, report: null };
  const a = (o.assumptions ?? {}) as Record<string, Record<string, unknown>>;
  const assumptions = spec.assumptions.map((s) => {
    const x = a[s.key];
    const n = (k: string) => Number(x?.[k]);
    if (!x || ![n("low"), n("base"), n("high")].every(Number.isFinite)) throw new Error(`${spec.id}: assumption "${s.key}" needs low, base and high numbers`);
    return { key: s.key, label: s.label, unit: s.unit, low: n("low"), base: n("base"), high: n("high"), why: isStr(x.why) ? stripDashes(x.why) : "" };
  });
  const basis = spec.bases ? (spec.bases.find((b) => b.id === o.basis)?.id ?? spec.bases[0].id) : null;
  return { applicable: true, reason: null, basis, assumptions, summary: isStr(o.summary) ? stripDashes(o.summary) : null, report: isStr(o.report) ? stripDashes(o.report) : null };
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
