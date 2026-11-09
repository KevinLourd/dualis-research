import { and, asc, eq, gte } from "drizzle-orm";
import { narratives } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { driversOf } from "../evidence";
import { parseThesisId, SIDE } from "../analysis/sides";
import { analysedSymbols } from "../watchlist";
import { narrativeSinceOf, SINCE_SUBJECT_KIND, sinceChoices, sinceKey } from "./since";

export * from "./since";

/**
 * Narrative Since (Kevin 2026-11-06, « Too old »): the month the market adopted its CURRENT story on a ticker, read
 * from the price path against the fair value. A news item or filing from before that month is "Too old": it may have
 * touched a driver once, but the price has digested it, so it cannot announce a crack or an inflection of the story
 * the market holds TODAY. Never more than `SINCE_CAP_MONTHS` back. One judgment per narrative version.
 */

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const NARRATIVE_SINCE_DIMENSION = "narrative-since";
/** Month-end closes of the last 13 months, each as a gap to today's fair value (the quote's gap scaled by the close). */
export async function pricePath(db: Db, symbol: string, gapNow: number | null, now = new Date()): Promise<string[]> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1)).toISOString().slice(0, 10);
  const bars = await db
    .select({ date: gold.priceBars.date, close: gold.priceBars.close })
    .from(gold.priceBars)
    .where(and(eq(gold.priceBars.symbol, symbol), gte(gold.priceBars.date, from)))
    .orderBy(asc(gold.priceBars.date));
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1].close;
  const byMonth = new Map<string, number>();
  for (const b of bars) byMonth.set(b.date.slice(0, 7), b.close);
  return [...byMonth].map(([m, close]) => {
    const vsLast = close / last - 1;
    const gap = gapNow === null ? null : (close / last) * (1 + gapNow) - 1;
    const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
    return gap === null ? `${m}: ${pct(vsLast)} vs today's price` : `${m}: ${pct(gap)} vs today's fair value`;
  });
}

export const narrativeSinceSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("narrative-since: needs the database");
    if (!ctx.complete) throw new Error("narrative-since: no LLM in the collector context (cli.ts sets ctx.complete)");
    const { judge } = (await nodeImport(new URL("../../../llm/judge.ts", import.meta.url).href)) as typeof import("@/llm/judge");
    const { symbol, side } = parseThesisId(subject);
    const d = await driversOf(ctx.db, symbol, side);
    if (!d) return { request: { symbol, side }, httpStatus: null, error: "no narrative or no driver for this thesis yet" };
    const choices = sinceChoices();
    const path = await pricePath(ctx.db, symbol, d.gapPct);
    const j = await judge(
      ctx.db,
      {
        subjectKind: SINCE_SUBJECT_KIND,
        subjectId: subject,
        questionKey: sinceKey(d.version),
        question: [
          `${symbol}, ${SIDE[side].label.toLowerCase()}: ${SIDE[side].story}. The narrative: ${d.narrative}`,
          "The reasons the market holds it:",
          ...d.drivers.map((x) => `${x.rank}. ${x.title}`),
          "",
          "Since which month has the market held THIS story, for these reasons?",
          `Read the price path below. Answer the month the current story took hold; if it is older than ${choices[0]}, answer ${choices[0]}.`,
          "News from before that month is already in the price: it cannot announce a turn of today's story.",
        ].join("\n"),
        input: path.length ? `Month-end price path:\n${path.join("\n")}` : "No price path collected.",
        choices,
      },
      ctx.complete,
    );
    return { request: { symbol, side, version: d.version }, httpStatus: null, payload: { since: j.verdict, judgmentId: j.id } };
  },
};

/** Current theses (`<symbol>:<side>`) of the analysed tickers whose narrative has no "since" month yet. */
async function subjects(db: Db): Promise<string[]> {
  const symbols = new Set(await analysedSymbols(db));
  const theses = (await db.select({ id: narratives.id, symbol: narratives.symbol }).from(narratives)).filter((n) => symbols.has(n.symbol));
  const done = await narrativeSinceOf(db, [...new Set(theses.map((t) => t.symbol))]);
  return theses.map((t) => t.id).filter((id) => !done.has(id));
}

export const narrativeSinceDim: Dimension = {
  name: NARRATIVE_SINCE_DIMENSION,
  description: "The month the market adopted each thesis' current story, read from the price path vs fair value (at most 6 months back). News older than that is Too old: already in the price.",
  sources: [narrativeSinceSource],
  subjects,
  // The judgment itself is the silver row (silver.judgments); evidence reads it when it rebuilds.
  promote: async (_db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: { claude: fetches.filter((f) => !f.error).length } }),
};
