import { DRIVER_CATEGORIES, type AnalysisAnswer, type ThesisSide, type ExhibitSpec, type RationaleAnswer, type RationaleSource } from "@/db/schema/analysis";
import { firstJsonObject } from "@/llm/judge";
import { stripDashes } from "../thesis/structure";

/** Bump when a prompt changes meaning: every ticker is analysed again. v7 (Kevin 2026-11-09): one analysis per thesis side. */
export const ANALYSIS_VERSION = "analysis@v7";

const METHOD = [
  "The analyst's method: he does not believe in one true value. The price reflects the market's NARRATIVE; the FAIR VALUE is what the business is worth if its plan works.",
  "The fair value is GIVEN in the facts (weighted from several valuation methods, with its range low to high): never compute another one.",
  "A ticker has a LONG thesis and a SHORT thesis. The long thesis is the PESSIMISTIC story the market holds, the reason the price sits at or below fair value; its turn (an inflection) is a buy. The short thesis is the OPTIMISTIC story, the reason the price sits at or above fair value; its turn (a crack) is a sell.",
  "Price below the fair value range: only the long thesis is written. Above it: only the short one. Inside the range: both are written, each on its own, and they compete.",
].join(" ");

export const ANALYSIS_SYSTEM = [
  "You are the equity research associate of a small-cap long/short analyst. You write for him, in plain English, short sentences.",
  METHOD,
  "Every figure you write comes from the facts given; you never invent a number. No rating (buy/hold/sell), no % upside, no time horizon, no price target other than the fair value given. No em dash, no en dash.",
  "Answer with JSON only, no prose, no code fence.",
].join(" ");

const SIDE_WORDS: Record<ThesisSide, { thesis: string; story: string; tone: string; against: string; consensus: string }> = {
  long: {
    thesis: "the LONG thesis",
    story: "the PESSIMISTIC story the market tells about the company, the reason the price sits at or below the fair value",
    tone: "a reason for pessimism (debt, a missed guide, a shrinking market, a dilution...)",
    against: "A fact that goes AGAINST this story (a record quarter under a gloomy story) is never a driver: it is the news that may turn one.",
    consensus: "analysts expect a decline or keep cutting estimates; a company no analyst follows (no consensus in the facts) is also a reason for the discount",
  },
  short: {
    thesis: "the SHORT thesis",
    story: "the OPTIMISTIC story the market tells about the company, the reason the price sits at or above the fair value",
    tone: "a reason for optimism (fast growth, a hot theme, a big contract, rising margins...)",
    against: "A fact that goes AGAINST this story (a missed quarter under a glowing story) is never a driver: it is the news that may crack one.",
    consensus: "analysts bake in strong growth or keep raising estimates",
  },
};

/** The previous version of the same thesis, kept word for word unless the facts changed what the market believes. */
export type PreviousThesis = { narrative: string; narrativeDetail?: string | null; drivers: { category: string; title: string; summary?: string | null; text: string }[] };

export function analysisPrompt(factsText: string, side: ThesisSide, previous: PreviousThesis | null = null): string {
  const w = SIDE_WORDS[side];
  return [
    "Facts (all from the collected data):",
    factsText,
    "",
    ...(previous
      ? [
          `Your previous version of ${w.thesis}:`,
          JSON.stringify(previous, null, 1),
          "Keep it WORD FOR WORD (same narrative, same drivers in the same order, same words) unless the facts above changed what the market believes. A new news item is not a reason to rewrite the story: news are judged against it separately. Rewrite only what the facts made wrong.",
          "",
        ]
      : []),
    `Write ${w.thesis} of this ticker as JSON:`,
    "{",
    `  "narrative": "<ONE short plain sentence, subject verb complement: ${w.story}, at most one figure, e.g. ${side === "long" ? "The market sees Kyungbang as a dying textile maker." : "The market sees Lifeway as a kefir brand that keeps growing fast."}>",`,
    '  "narrativeDetail": "<3 to 5 sentences: why the market holds this story and where the price sits versus the fair value and its range, with the figures>",',
    '  "drivers": [ 1 to 5, the REASONS the market holds that story, most important first:',
    `    {"category": <one of: ${DRIVER_CATEGORIES.map((c) => JSON.stringify(c)).join(", ")}>, "title": "<5 to 9 words, the reason itself>", "summary": "<ONE short plain sentence, subject verb complement, no figure>", "text": "<2 to 3 sentences with the reported figures>",`,
    '     "exhibits": [1 or 2 charts that show it: {"title": "<chart title>", "chart": "bar" | "line", "series": [<1 to 3 keys from the stored chart series list, same period type>], "takeaway": "<one line: what the chart shows>"}]}',
    "  ]",
    "}",
    `Every driver SUPPORTS the narrative: it is a reason the market believes the story, ${w.tone}. ${w.against}`,
    "Drivers are every reason the market really holds, and only those: 1 to 5, as many as there are. Never invent a reason to fill the list, and never leave one out: a reason left out is a reason whose reversal no news can show.",
    `"Consensus expectations" is a driver when the analyst consensus agrees with the narrative, even when it only follows another reason: ${w.consensus}. When the consensus goes against this story, it is not one of its drivers.`,
    "Each driver needs at least one exhibit whose series keys appear EXACTLY in the stored chart series list.",
    "The operating KPIs the company reports (backlog, orders, subscribers...) are facts like the statements: they often show a business changing before its revenue does. Weigh them like any figure: a driver can rest on one (its series can be charted), and a KPI that goes against the story is said in the report.",
  ].join("\n");
}

export const REPORT_SYSTEM = [
  "You write equity research reports for a small-cap long/short analyst, in the style of an independent research note: clear headings, short paragraphs, the figures that matter.",
  METHOD,
  "Every figure comes from the facts given. No rating, no % upside, no time horizon, no price target other than the fair value. No em dash, no en dash. Markdown only.",
].join(" ");

export function reportPrompt(factsText: string, analysis: AnalysisAnswer, exhibits: { number: number; title: string; takeaway: string }[], name: string, side: ThesisSide): string {
  return [
    "Facts:",
    factsText,
    "",
    `The analysis already written for ${SIDE_WORDS[side].thesis} (narrative, drivers):`,
    JSON.stringify(analysis, null, 1),
    "",
    "Exhibits available (charts drawn from the stored data), cite each where it supports the text by writing [EXHIBIT n] on its own line:",
    exhibits.map((e) => `EXHIBIT ${e.number}: ${e.title}: ${e.takeaway}`).join("\n"),
    "",
    `Write the Research Report on ${name}: 900 to 1,400 words, markdown, these sections as ## headings, in order:`,
    "Executive Summary, Industry, Business Overview, Economics, Expectations, Management, Capital & float, Valuation, Catalysts, Risks.",
    "Executive Summary: the narrative, the fair value given and its range, the drivers. Valuation: the fair value given, its range and the methods behind it, as given. Catalysts: the evidence so far.",
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
  if (!isStr(o.narrative)) throw new Error("analysis: no narrative");
  const drivers = Array.isArray(o.drivers) ? (o.drivers as Record<string, unknown>[]) : [];
  if (drivers.length === 0) throw new Error("analysis: no narrative driver");
  return {
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
