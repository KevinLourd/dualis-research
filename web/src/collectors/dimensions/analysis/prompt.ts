import { DRIVER_CATEGORIES, type AnalysisAnswer, type ExhibitSpec, type RationaleAnswer, type RationaleSource } from "@/db/schema/analysis";
import { firstJsonObject } from "@/llm/judge";
import { stripDashes } from "../thesis/structure";

/** Bump when a prompt changes meaning: every ticker is analysed again. */
export const ANALYSIS_VERSION = "analysis@v5";

const METHOD = [
  "The analyst's method: he does not believe in one true value. The price reflects the market's NARRATIVE; the FAIR VALUE is what the business is worth if its plan works,",
  "from normalized reported earnings and a multiple (e.g. 10x EV/EBITDA on reported EBITDA, minus net debt, divided by shares), or comparables.",
  "The NARRATIVE explains the gap between the price and the fair value: price below fair value = the pessimistic story that explains the discount; price above = the optimistic story that explains the premium.",
  "Long = price below fair value while that bad narrative inflects. Short = price above fair value while that loved narrative cracks.",
].join(" ");

export const ANALYSIS_SYSTEM = [
  "You are the equity research associate of a small-cap long/short analyst. You write for him, in plain English, short sentences.",
  METHOD,
  "Every figure you write comes from the facts given; you never invent a number. No rating (buy/hold/sell), no % upside, no time horizon, no price target other than the fair value. No em dash, no en dash.",
  "Answer with JSON only, no prose, no code fence.",
].join(" ");

export function analysisPrompt(factsText: string): string {
  return [
    "Facts (all from the collected data):",
    factsText,
    "",
    "Write the analysis of this ticker as JSON:",
    "{",
    '  "fairValue": {"value": <number per share, in the reporting currency>, "currency": "<ISO>", "method": "<the full calculation in one line: multiple, which reported figure and period, net debt, shares -> value per share>", "label": "<the method in a few words, no arithmetic, e.g. 5.9x EV/EBITDA, 4-year median>", "inputs": [{"label": "<figure used>", "value": <number as given in the facts, full units>, "period": "<period>"}]},',
    '  "narrative": "<ONE short plain sentence, subject verb complement: the story the market tells about the company that explains why the price sits below (or above) your fair value, at most one figure, e.g. The market sees Kyungbang as a dying textile maker.>",',
    '  "narrativeDetail": "<3 to 5 sentences: why the price sits where it does versus that fair value, so far, with the figures>",',
    '  "drivers": [ 1 to 5, the REASONS the market holds that narrative, most important first:',
    `    {"category": <one of: ${DRIVER_CATEGORIES.map((c) => JSON.stringify(c)).join(", ")}>, "title": "<5 to 9 words, the reason itself>", "summary": "<ONE short plain sentence, subject verb complement, no figure>", "text": "<2 to 3 sentences with the reported figures>",`,
    '     "exhibits": [1 or 2 charts that show it: {"title": "<chart title>", "chart": "bar" | "line", "series": [<1 to 3 keys from the stored chart series list, same period type>], "takeaway": "<one line: what the chart shows>"}]}',
    "  ]",
    "}",
    "Fair value: use the reported figures and the valuation lines above; the 5-year EV/EBITDA median is a good default multiple when the business is stable. If EBITDA is negative, use another reported base (revenue, book value) and say so.",
    "Every driver SUPPORTS the narrative: it is a reason the market believes the story. Price below fair value: each driver is a reason for pessimism (debt, a missed guide, a shrinking market, a dilution...). Price above: each is a reason for optimism. A fact that goes AGAINST the narrative (a record quarter under a gloomy story) is never a driver: it is the news that may reverse one.",
    "Drivers are every reason the market really holds, and only those: 1 to 5, as many as there are. Never invent a reason to fill the list, and never leave one out: a reason left out is a reason whose reversal no news can show.",
    `"Consensus expectations" is a driver when the analyst consensus agrees with the narrative, even when it only follows another reason (estimates cut because the cycle turns down): below fair value, analysts expect a decline or keep cutting estimates; above, they bake in strong growth or keep raising them. A company no analyst follows (no consensus in the facts) is also a reason for the discount. When the consensus goes against the price sitting below (or above) fair value, it is not a driver of this narrative.`,
    "Each driver needs at least one exhibit whose series keys appear EXACTLY in the stored chart series list.",
  ].join("\n");
}

export const REPORT_SYSTEM = [
  "You write equity research reports for a small-cap long/short analyst, in the style of an independent research note: clear headings, short paragraphs, the figures that matter.",
  METHOD,
  "Every figure comes from the facts given. No rating, no % upside, no time horizon, no price target other than the fair value. No em dash, no en dash. Markdown only.",
].join(" ");

export function reportPrompt(factsText: string, analysis: AnalysisAnswer, exhibits: { number: number; title: string; takeaway: string }[], name: string): string {
  return [
    "Facts:",
    factsText,
    "",
    "The analysis already written (fair value, narrative, drivers):",
    JSON.stringify(analysis, null, 1),
    "",
    "Exhibits available (charts drawn from the stored data), cite each where it supports the text by writing [EXHIBIT n] on its own line:",
    exhibits.map((e) => `EXHIBIT ${e.number}: ${e.title}: ${e.takeaway}`).join("\n"),
    "",
    `Write the Research Report on ${name}: 900 to 1,400 words, markdown, these sections as ## headings, in order:`,
    "Executive Summary, Industry, Business Overview, Economics, Expectations, Management, Capital & float, Valuation, Catalysts, Risks.",
    "Executive Summary: the narrative, the fair value and its method in one line, the drivers. Valuation: the fair value arithmetic. Catalysts: the evidence so far.",
    "Say plainly when a section has no collected data (e.g. no consensus published). No title line, no disclaimer (added after).",
  ].join("\n");
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The model's analysis, typed. Shape errors fail loud (the fetch fails, the Data page shows it, the next run asks
 * again). Exhibit series are matched against the stored ones by the caller.
 */
export function parseAnalysis(text: string): AnalysisAnswer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  const fv = o.fairValue as Record<string, unknown> | undefined;
  const value = Number(fv?.value);
  // Zero is an answer (net debt above the business value: the equity is worth nothing); a missing or negative one is not.
  if (!fv || !(value >= 0) || !isStr(fv.method)) throw new Error(`analysis: no fair value with a method: ${JSON.stringify(fv)}`);
  if (!isStr(o.narrative)) throw new Error("analysis: no narrative");
  const drivers = Array.isArray(o.drivers) ? (o.drivers as Record<string, unknown>[]) : [];
  if (drivers.length === 0) throw new Error("analysis: no narrative driver");
  return {
    fairValue: {
      value,
      currency: isStr(fv.currency) ? fv.currency : "",
      method: stripDashes(fv.method),
      label: isStr(fv.label) ? stripDashes(fv.label) : null,
      inputs: (Array.isArray(fv.inputs) ? fv.inputs : [])
        .map((i: Record<string, unknown>) => ({ label: String(i.label ?? ""), value: Number(i.value), period: String(i.period ?? "") }))
        .filter((i) => i.label && Number.isFinite(i.value)),
    },
    narrative: stripDashes(o.narrative),
    narrativeDetail: isStr(o.narrativeDetail) ? stripDashes(o.narrativeDetail) : null,
    drivers: drivers.slice(0, 5).map((d, i) => {
      const category = DRIVER_CATEGORIES.find((c) => c === d.category);
      if (!category) throw new Error(`analysis: driver ${i + 1} category "${String(d.category)}" is not a Driver Category`);
      if (!isStr(d.title) || !isStr(d.text)) throw new Error(`analysis: driver ${i + 1} has no title or text`);
      return {
        category,
        title: stripDashes(d.title),
        summary: isStr(d.summary) ? stripDashes(d.summary) : null,
        text: stripDashes(d.text),
        exhibits: (Array.isArray(d.exhibits) ? (d.exhibits as Record<string, unknown>[]) : []).map(
          (e): ExhibitSpec => ({ title: stripDashes(String(e.title ?? "")), chart: e.chart === "line" ? "line" : "bar", series: Array.isArray(e.series) ? e.series.map(String) : [], takeaway: stripDashes(String(e.takeaway ?? "")) }),
        ),
      };
    }),
  };
}

export const RATIONALE_SYSTEM = [
  "You explain, for a small-cap long/short analyst, WHY the market holds the narrative it holds on a stock. Plain English, short sentences.",
  "Every claim rests on the facts given: the price path and its turning points, the reported numbers, the consensus, the news and filings. You never invent a number.",
  "No rating, no % upside, no time horizon. No em dash, no en dash. Answer with JSON only, no prose, no code fence.",
].join(" ");

export function rationalePrompt(factsText: string, analysis: AnalysisAnswer, exhibits: { number: number; title: string; takeaway: string }[]): string {
  return [
    "Facts:",
    factsText,
    "",
    `The narrative: ${analysis.narrative}`,
    "Its drivers:",
    ...analysis.drivers.map((d, i) => `${i + 1}. [${d.category}] ${d.title}: ${d.text}`),
    "Exhibits already drawn:",
    ...exhibits.map((e) => `EXHIBIT ${e.number}: ${e.title}: ${e.takeaway}`),
    "",
    "Write the Narrative Rationale: why the market holds this story, how it got there (the price path and its turning points, what the reported numbers did, the news that shaped it), 4 to 7 claims in order.",
    "JSON:",
    "{",
    '  "summary": "<1 or 2 sentences: the rationale in short>",',
    '  "claims": [{"text": "<one or two sentences with the figures>", "drivers": [<driver numbers it rests on>], "sources": [{"type": "exhibit" | "evidence" | "figure" | "price", "ref": "<exhibit number | the news or filing headline as listed | the series key and period, e.g. line:revenue 2025-12 | the month, e.g. 2025-06>", "label": "<short label>"}]}],',
    '  "exhibits": [0 to 2 new charts the claims need (e.g. the price path), {"title": "...", "chart": "bar" | "line", "series": [<keys from the stored chart series list>], "takeaway": "<one line>"}]',
    "}",
    "Every claim cites at least one source. A new exhibit is numbered after the existing ones; cite it by that number.",
  ].join("\n");
}

const SOURCE_TYPES: readonly RationaleSource["type"][] = ["exhibit", "evidence", "figure", "price"];

export function parseRationale(text: string, driverCount: number): RationaleAnswer {
  const o = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (!isStr(o.summary)) throw new Error("rationale: no summary");
  const claims = (Array.isArray(o.claims) ? (o.claims as Record<string, unknown>[]) : []).filter((c) => isStr(c.text));
  if (claims.length === 0) throw new Error("rationale: no claim");
  return {
    summary: stripDashes(o.summary),
    claims: claims.map((c) => ({
      text: stripDashes(String(c.text)),
      drivers: (Array.isArray(c.drivers) ? c.drivers : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= driverCount),
      sources: (Array.isArray(c.sources) ? (c.sources as Record<string, unknown>[]) : [])
        .filter((s) => SOURCE_TYPES.includes(s.type as RationaleSource["type"]) && s.ref !== undefined && s.ref !== null)
        .map((s) => ({ type: s.type as RationaleSource["type"], ref: String(s.ref), label: stripDashes(String(s.label ?? s.ref)) })),
    })),
    exhibits: (Array.isArray(o.exhibits) ? (o.exhibits as Record<string, unknown>[]) : []).map(
      (e): ExhibitSpec => ({ title: stripDashes(String(e.title ?? "")), chart: e.chart === "line" ? "line" : "bar", series: Array.isArray(e.series) ? e.series.map(String) : [], takeaway: stripDashes(String(e.takeaway ?? "")) }),
    ),
  };
}
