import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { judge } from "@/llm/judge";
import type { VisualExhibit, VisualInput } from "./data";

/** The chart of a post: the most striking Exhibit of the drivers the Idea cites, or the price when the Idea is about price. */
export type ChartChoice = { kind: "price"; reason: string | null } | { kind: "exhibit"; exhibit: VisualExhibit; reason: string | null };

export const PRICE_CHOICE = "price";
export const CHART_QUESTION_VERSION = "visual-chart@v1";

export const CHART_QUESTION = [
  "This Idea becomes a post with ONE chart: the key graph that shows why the analyst sees an opportunity, the most striking one.",
  "Pick the Exhibit (by id) that shows the driver the Idea talks about most strikingly: the economics of the business, the trend that turns, the gap that matters.",
  `Pick "${PRICE_CHOICE}" only when the Idea is about the share price itself (its gap to fair value, a price move), never by default.`,
].join(" ");

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(4))));

/** What the judge reads about one Exhibit: its driver, title, takeaway and each series from its first to its last value. */
function describe(e: VisualExhibit): string {
  const lines = e.series.map((s) => {
    const values = e.points.map((p) => ({ period: p.period, v: p.values[s.key] })).filter((x): x is { period: string; v: number } => typeof x.v === "number");
    if (values.length === 0) return `  ${s.label}: no data`;
    const first = values[0];
    const last = values.at(-1)!;
    return `  ${s.label} (${s.unit}${s.currency ? ` ${s.currency}` : ""}): ${values.map((x) => `${x.period.slice(0, 7)} ${fmt(x.v)}`).join(", ")}${values.length > 1 ? ` (first ${fmt(first.v)}, last ${fmt(last.v)})` : ""}`;
  });
  return [`Exhibit id ${e.id}, driver "${e.driverTitle}": ${e.title}. ${e.takeaway}`, ...lines].join("\n");
}

export function chartJudgeInput(input: VisualInput): string {
  const last = input.bars.at(-1);
  const price = last
    ? `Choice ${PRICE_CHOICE}: ${input.companyName ?? input.symbol} share price over 12 months, last ${fmt(last.close)}${input.fair ? `, fair value ${fmt(input.fair.value)}` : ""}.`
    : `Choice ${PRICE_CHOICE}: the share price.`;
  return [`Idea: ${input.title}`, `Angle: ${input.angle}`, "", price, "", ...input.exhibits.map(describe)].join("\n");
}

/**
 * Judged once per Idea and set of Exhibits (silver.judgments): an Idea citing no driver with an Exhibit draws the price
 * without asking.
 */
export async function chooseChart(db: Db, ideaId: string, input: VisualInput, complete: Complete | undefined): Promise<ChartChoice> {
  if (input.exhibits.length === 0) return { kind: "price", reason: null };
  if (!complete) throw new Error("no LLM in the collector context: the chart of an Idea citing a driver is picked by a judgment");
  const ids = input.exhibits.map((e) => e.id);
  const j = await judge(
    db,
    {
      subjectKind: "content-idea",
      subjectId: ideaId,
      questionKey: `${CHART_QUESTION_VERSION}:${[...ids].sort().join(",")}`,
      question: CHART_QUESTION,
      input: chartJudgeInput(input),
      choices: [...ids, PRICE_CHOICE],
    },
    complete,
  );
  if (j.verdict === PRICE_CHOICE) return { kind: "price", reason: j.reason };
  return { kind: "exhibit", exhibit: input.exhibits.find((e) => e.id === j.verdict)!, reason: j.reason };
}

/** One point of the chosen chart the callout can point at: an Exhibit period, or a month-end close of the price. */
export type CalloutPoint = { id: string; label: string };

/** What the chart says out loud (Kevin 2026-11-09: « une flèche dessus, un texte de note, orienté regardez »). */
export type Callout = {
  /** The point the arrow hits: one of `calloutPoints`. */
  point: string;
  /** The note on the arrow, a few words. */
  note: string;
  /** The chart's headline: the claim, never a neutral label. */
  title: string;
  /** Index in `input.news` of the most prestigious source, with its web domain (for its logo); null without news. */
  news: { index: number; domain: string } | null;
};

export const CALLOUT_SYSTEM = [
  "You annotate ONE chart for a breaking-news style investing post (Dualis Research). The reader must see in one second where to look and why it matters.",
  "Answer with JSON only, no prose, no code fence:",
  '{"point": "<the id of the ONE point that tells the story: the jump, the crack, the turn>", "note": "<3 to 6 words on the arrow, with its number, e.g. Profit x4 in one quarter>", "title": "<the alarm in 4 to 9 words with its number, e.g. Look: profit just jumped 4x>", "news": <null, or {"index": <the most prestigious source among the news listed, e.g. Reuters or Bloomberg over a blog>, "domain": "<that publisher\'s own web domain, e.g. reuters.com>"}>}',
  "Plain words, no jargon, no em or en dash, no emoji. Use only numbers you can read in the points below. The note must be true of the point it sits on.",
].join("\n");

export function calloutPoints(input: VisualInput, choice: ChartChoice): CalloutPoint[] {
  if (choice.kind === "exhibit") {
    const lead = choice.exhibit.series[0];
    return choice.exhibit.points
      .filter((p) => typeof p.values[lead.key] === "number")
      .map((p) => ({ id: p.period, label: `${p.period.slice(0, 7)} ${lead.label} ${fmt(p.values[lead.key] as number)}` }));
  }
  // The price: the last close of each month, and the last close.
  const byMonth = new Map<string, { date: string; close: number }>();
  for (const b of input.bars) byMonth.set(b.date.slice(0, 7), b);
  return [...byMonth.values()].map((b) => ({ id: b.date, label: `${b.date} close ${fmt(b.close)}` }));
}

export function calloutPrompt(input: VisualInput, choice: ChartChoice, points: CalloutPoint[]): string {
  const last = input.bars.at(-1);
  const chart = choice.kind === "exhibit" ? `${choice.exhibit.title}. ${choice.exhibit.takeaway}` : `${input.companyName ?? input.symbol} share price over 12 months`;
  return [
    `Idea: ${input.title}`,
    `Angle: ${input.angle}`,
    input.fair && last ? `Share price ${fmt(last.close)}, fair value ${fmt(input.fair.value)}` : "",
    "",
    `Chart: ${chart}`,
    "Points (id: value):",
    ...points.map((p) => `- ${p.id}: ${p.label}`),
    ...(input.news.length ? ["", "News the Idea cites:", ...input.news.map((n, i) => `- ${i}: ${n.publisher}: ${n.headline}${n.url ? ` (${n.url})` : ""}`)] : ["", "News the Idea cites: none (answer news null)"]),
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

/** Reads the callout answer; throws with the reason when it is not the JSON asked for. */
export function parseCallout(text: string, points: CalloutPoint[], newsCount: number): Callout {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("callout answer holds no JSON object");
  const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const str = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`callout answer has no ${name}`);
    return v.trim().replace(/\s*[—–]\s*/g, ", ");
  };
  const point = str(o.point, "point");
  if (!points.some((p) => p.id === point)) throw new Error(`callout point ${point} is not on the chart`);
  let news: Callout["news"] = null;
  if (newsCount > 0) {
    const n = o.news as Record<string, unknown> | null;
    if (!n || typeof n.index !== "number" || n.index < 0 || n.index >= newsCount) throw new Error("callout answer has no valid news index");
    news = { index: n.index, domain: str(n.domain, "news domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "") };
  }
  return { point, note: str(o.note, "note"), title: str(o.title, "title"), news };
}

/** One call per chart drawn (the render is made once per visuals version; the answer is kept in its bronze request). */
export async function writeCallout(input: VisualInput, choice: ChartChoice, complete: Complete | undefined): Promise<Callout> {
  if (!complete) throw new Error("no LLM in the collector context: the chart's arrow and note are written by Claude");
  const points = calloutPoints(input, choice);
  const { text } = await complete({ system: CALLOUT_SYSTEM, prompt: calloutPrompt(input, choice, points) });
  return parseCallout(text, points, input.news.length);
}
