import { eq, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { evidence, NARRATIVE_TAGS, narratives, narrativeStates, parseTag, type GoldEvidence } from "@/db/schema/analysis";
import type { Db } from "@/db/types";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { driversOf, sideWords, verdictRank } from "../evidence";
import { analysedSymbols } from "../watchlist";

/**
 * Narrative State (Kevin 2026-11-06): the news are tagged against each driver (`evidence`); here the LLM reads them
 * and tags each DRIVER with the same five tags (several weak reversals may make a strong one), then tags the whole
 * NARRATIVE from its drivers' tags. The ticker tag is what the Signal reads. One judgment per input: the same news
 * and the same driver tags are never asked twice.
 */

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const NARRATIVE_STATE_DIMENSION = "narrative-state";
export const DRIVER_STATE_QUESTION = "driver-state@v1";
export const TICKER_STATE_QUESTION = "ticker-state@v1";

type StateVerdict = { id: string; driverId: string | null; verdict: string; probability: number; reason: string | null; judgmentId: string; evidenceIds: string[] };
export type NarrativeStatePayload = { drivers: StateVerdict[]; ticker: StateVerdict };

const TAGS_TEXT = "Verdict: reversal:strong, reversal:weak, noise, continuation:weak or continuation:strong.";

/** One driver's judged news, newest first: the lines the driver tag rests on. */
export function driverNewsLines(rows: GoldEvidence[], driverId: string): { lines: string[]; ids: string[] } {
  const hits = rows
    .map((e) => ({ e, v: e.verdicts.find((x) => x.driverId === driverId) }))
    .filter((x): x is { e: GoldEvidence; v: NonNullable<typeof x.v> } => !!x.v && x.v.effect !== "noise")
    .sort((a, b) => b.e.eventAt.getTime() - a.e.eventAt.getTime());
  return {
    lines: hits.map(({ e, v }) => `${e.eventDay} [${v.effect}:${v.strength}] ${e.headline}${v.why ? `. ${v.why}` : ""}`),
    ids: hits.map(({ e }) => e.id),
  };
}

export const narrativeStateSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("narrative-state: needs the database");
    if (!ctx.complete) throw new Error("narrative-state: no LLM in the collector context (cli.ts sets ctx.complete)");
    const { judge } = (await nodeImport(new URL("../../../llm/judge.ts", import.meta.url).href)) as typeof import("@/llm/judge");
    const d = await driversOf(ctx.db, symbol);
    if (!d) return { request: { symbol }, httpStatus: null, error: "no narrative or no driver for this ticker yet" };
    const rows = await ctx.db.select().from(evidence).where(eq(evidence.symbol, symbol));
    const side = sideWords(d.gapPct);

    const drivers: StateVerdict[] = [];
    for (const driver of d.drivers) {
      const { lines, ids } = driverNewsLines(rows, driver.id);
      const input = lines.length ? lines.join("\n") : "No news or filing of the last 12 months bears on this reason.";
      const j = await judge(
        ctx.db,
        {
          subjectKind: "driver-state",
          subjectId: driver.id,
          questionKey: `${DRIVER_STATE_QUESTION}:${d.version}:${fnv(input)}`,
          question: [
            `${symbol}. The market's narrative, ${side.story}: ${d.narrative}`,
            `ONE of the reasons the market holds it (${driver.category}): ${driver.title}. ${driver.text}`,
            "",
            "Below, every news item and filing of the last 12 months that bears on this reason, newest first, each already tagged against it.",
            `Where does this reason stand NOW? reversal = it is turning against the story (${side.reversal}); continuation = it holds and gets stronger; noise = nothing moves it.`,
            "Weigh them: recent beats old, several weak reversals in a row can make a strong one, one strong continuation after a reversal can cancel it.",
            TAGS_TEXT,
          ].join("\n"),
          input,
          choices: [...NARRATIVE_TAGS],
        },
        ctx.complete,
      );
      drivers.push({ id: driver.id, driverId: driver.id, verdict: j.verdict, probability: j.probability, reason: j.reason, judgmentId: j.id, evidenceIds: ids });
    }

    const input = d.drivers.map((x, i) => `${x.rank}. ${x.title} (${x.category}): ${drivers[i].verdict}. ${drivers[i].reason ?? ""}`).join("\n");
    const t = await judge(
      ctx.db,
      {
        subjectKind: "ticker-state",
        subjectId: symbol,
        questionKey: `${TICKER_STATE_QUESTION}:${d.version}:${fnv(input)}`,
        question: [
          `${symbol}. The market's narrative, ${side.story}: ${d.narrative}`,
          "Below, the reasons the market holds it (Narrative Drivers, most important first) and where each one stands now.",
          `Where does the WHOLE narrative stand? reversal = the story is turning (${side.reversal}); continuation = the story holds and gets stronger; noise = nothing moves it.`,
          "Weigh the drivers by importance: the first one matters most.",
          TAGS_TEXT,
        ].join("\n"),
        input,
        choices: [...NARRATIVE_TAGS],
      },
      ctx.complete,
    );
    const reversals = rows
      .flatMap((e) => e.verdicts.filter((v) => v.effect === "reversal").map((v) => ({ e, v })))
      .sort((a, b) => verdictRank(a.v) - verdictRank(b.v) || b.e.eventAt.getTime() - a.e.eventAt.getTime());
    const ticker: StateVerdict = { id: symbol, driverId: null, verdict: t.verdict, probability: t.probability, reason: t.reason, judgmentId: t.id, evidenceIds: [...new Set(reversals.map((x) => x.e.id))] };
    const payload: NarrativeStatePayload = { drivers, ticker };
    return { request: { symbol, version: d.version }, httpStatus: null, payload };
  },
};

async function subjects(db: Db): Promise<string[]> {
  const withNarrative = new Set((await db.select({ symbol: narratives.symbol }).from(narratives)).map((n) => n.symbol));
  return (await analysedSymbols(db)).filter((s) => withNarrative.has(s));
}

export const narrativeStateDim: Dimension = {
  name: NARRATIVE_STATE_DIMENSION,
  description: "Where each Narrative Driver stands given its tagged news, then where the whole narrative stands given its drivers: reversal / continuation (strong or weak) or noise, with why. The Signal reads the ticker's tag.",
  sources: [narrativeStateSource],
  subjects,
  promote: async (db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await promoteNarrativeStates(db, fetches) } }),
};

/** gold.narrative_states from this run's latest answer per ticker (the judgments themselves live in silver.judgments). */
export async function promoteNarrativeStates(db: Db, fetches: BronzeFetch[], now = new Date()): Promise<number> {
  const latest = new Map<string, NarrativeStatePayload>();
  for (const f of fetches.filter((x) => !x.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f.payload as NarrativeStatePayload);
  const rows: (typeof narrativeStates.$inferInsert)[] = [];
  for (const [symbol, p] of latest) {
    for (const [level, v] of [...p.drivers.map((x) => ["driver", x] as const), ["ticker", p.ticker] as const]) {
      const t = parseTag(v.verdict);
      rows.push({ id: v.id, symbol, level, driverId: v.driverId, effect: t.effect, strength: t.strength, why: v.reason, probability: v.probability, evidenceIds: v.evidenceIds, judgmentId: v.judgmentId, asOf: now });
    }
  }
  const symbols = [...latest.keys()];
  await db.transaction(async (tx) => {
    if (symbols.length) await tx.delete(narrativeStates).where(inArray(narrativeStates.symbol, symbols));
    if (rows.length) await tx.insert(narrativeStates).values(rows);
  });
  return rows.length;
}
