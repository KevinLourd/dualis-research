import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { CatalystKind } from "@/db/schema/catalysts";
import { companyProfiles, filings, tickers } from "@/db/schema/gold";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
import { judgments } from "@/db/schema/silver";
import { theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { analysedSymbols } from "../watchlist";
import { rebuildCatalysts } from "./gold";
import { CATALYST_QUESTION_KEY, catalystRequest, itemSubject, type JudgedItem, parseItemSubject, SUBJECT_KIND } from "./question";

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const CATALYSTS_DIMENSION = "catalysts";
export const JUDGE_SOURCE = "claude";
/** Items judged: published (news) or filed (filings) in the last 7 days. Older items are not fresh evidence. */
export const JUDGE_HORIZON_DAYS = 7;
const PARALLEL = 6;

/** Runner subject: `<kind>:<symbol>|<item id>`; the stored judgment keys on (subject kind, `<symbol>|<item id>`). */
const runnerSubject = (kind: CatalystKind, symbol: string, itemId: string) => `${kind}:${itemSubject(symbol, itemId)}`;
function parseRunnerSubject(subject: string): { kind: CatalystKind; symbol: string; itemId: string } {
  const i = subject.indexOf(":");
  const kind = subject.slice(0, i) as CatalystKind;
  if (!(kind in SUBJECT_KIND)) throw new Error(`catalysts: subject "${subject}" has no kind`);
  return { kind, ...parseItemSubject(subject.slice(i + 1)) };
}

/**
 * (ticker, item) pairs to judge: a news item tied to the ticker or a filing of the ticker inside the horizon, the
 * ticker has a narrative, no stored judgment yet. Judged once: a stored pair never comes back.
 */
export async function pendingSubjects(db: Db, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - JUDGE_HORIZON_DAYS * 86400_000);
  const scope = new Set(await analysedSymbols(db));
  const withNarrative = (await db.select({ symbol: theses.symbol }).from(theses).where(isNotNull(theses.narrative))).map((r) => r.symbol).filter((s) => scope.has(s));
  if (withNarrative.length === 0) return [];
  const eventTime = sql`coalesce(${goldNewsLinks.publishedAt}, ${goldNewsLinks.firstSeenAt})`;
  const news = await db
    .select({ symbol: goldNewsLinks.symbol, id: goldNewsLinks.newsItemId })
    .from(goldNewsLinks)
    .where(and(inArray(goldNewsLinks.symbol, withNarrative), sql`${eventTime} >= ${since.toISOString()}`))
    .orderBy(sql`${eventTime} desc`);
  const filed = await db
    .select({ symbol: filings.symbol, id: filings.id })
    .from(filings)
    .where(and(inArray(filings.symbol, withNarrative), gte(filings.filedAt, since)));
  const done = new Set(
    (
      await db
        .select({ kind: judgments.subjectKind, subjectId: judgments.subjectId })
        .from(judgments)
        .where(and(inArray(judgments.subjectKind, Object.values(SUBJECT_KIND)), eq(judgments.questionKey, CATALYST_QUESTION_KEY)))
    ).map((j) => `${j.kind}\u0000${j.subjectId}`),
  );
  const pending = (kind: CatalystKind, rows: { symbol: string; id: string }[]) =>
    rows.filter((r) => !done.has(`${SUBJECT_KIND[kind]}\u0000${itemSubject(r.symbol, r.id)}`)).map((r) => runnerSubject(kind, r.symbol, r.id));
  return [...pending("news", news), ...pending("filing", filed)];
}

/** Everything the question needs about one ticker and one item, read from gold. */
async function requestFor(db: Db, kind: CatalystKind, symbol: string, itemId: string) {
  let item: JudgedItem;
  if (kind === "news") {
    const [n] = await db.select().from(goldNewsItems).where(eq(goldNewsItems.id, itemId));
    if (!n) throw new Error(`news item ${itemId} is not in gold.news_items`);
    item = { kind, title: n.title, publisher: n.publisher, summary: n.summary, at: n.publishedAt };
  } else {
    const [f] = await db.select().from(filings).where(eq(filings.id, itemId));
    if (!f) throw new Error(`filing ${itemId} is not in gold.filings`);
    item = { kind, title: f.form ? `${f.form}: ${f.title}` : f.title, publisher: f.registry, summary: null, at: f.filedAt };
  }
  const [thesis] = await db.select().from(theses).where(eq(theses.symbol, symbol));
  const [profile] = await db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, symbol));
  const [ticker] = await db.select({ position: tickers.position }).from(tickers).where(eq(tickers.symbol, symbol));
  return catalystRequest({ symbol, name: profile?.name ?? null, position: ticker?.position ?? null }, thesis ?? null, item);
}

/**
 * The judge as a source: one "fetch" = one stored judgment through the shared `judge()` (Claude on Thierry's
 * subscription). The raw answer lands in bronze like any vendor answer; a failed call is a failed fetch on the Data page.
 */
export function judgeSource(complete?: Complete): Source {
  return {
    name: JUDGE_SOURCE,
    requiredEnv: complete ? [] : ["CLAUDE_OAUTH_TOKEN"],
    covers: () => true,
    concurrency: PARALLEL,
    fetch: async (subject: string, ctx: SourceContext): Promise<FetchOutcome> => {
      if (!ctx.db) throw new Error("catalysts: the judge source needs the database");
      // Node only, hidden from the bundler: the console Worker lists dimensions and must never ship the Claude Agent SDK.
      const { judge } = (await nodeImport(new URL("../../../llm/judge.ts", import.meta.url).href)) as typeof import("@/llm/judge");
      const run = complete ?? ctx.complete;
      if (!run) throw new Error("catalysts: no LLM in the collector context (cli.ts sets ctx.complete)");
      const { kind, symbol, itemId } = parseRunnerSubject(subject);
      const req = await requestFor(ctx.db, kind, symbol, itemId);
      const key = { subjectKind: SUBJECT_KIND[kind], subjectId: itemSubject(symbol, itemId), questionKey: CATALYST_QUESTION_KEY };
      const j = await judge(ctx.db, { ...key, question: req.question, input: req.input, choices: req.choices }, run);
      return {
        request: { ...key, choices: req.choices },
        httpStatus: null,
        payload: { judgmentId: j.id, verdict: j.verdict, probability: j.probability, citedSentence: j.citedSentence, reason: j.reason, model: j.model, raw: j.raw },
      };
    },
  };
}

/**
 * Catalysts: for each new news item or filing of a ticker, does it contradict the market's narrative (the story
 * cracks) or continue it? Judged once (silver.judgments), then rolled into silver.catalyst_events (one per ticker,
 * direction and day, every item and source behind it) and the gold evidence list. Runs after news, filings and thesis.
 */
export function catalystsDimension(complete?: Complete): Dimension {
  return {
    name: CATALYSTS_DIMENSION,
    description: "Per news item or filing and ticker: does it contradict the market's narrative or continue it? Judged once by Claude.",
    sources: [judgeSource(complete)],
    subjects: (db) => pendingSubjects(db),
    promote: (db: Db): Promise<PromoteResult> => rebuildCatalysts(db),
  };
}

export const catalysts = catalystsDimension();
