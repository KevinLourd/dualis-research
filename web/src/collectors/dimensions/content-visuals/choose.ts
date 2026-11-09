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
