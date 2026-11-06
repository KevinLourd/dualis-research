import { and, desc, eq, inArray } from "drizzle-orm";
import * as gold from "@/db/schema/gold";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
import { onedriveDocuments } from "@/db/schema/onedrive";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { DEFAULT_MODEL } from "@/llm/model";
import { findPrivateFile } from "@/private/files";
import type { FetchOutcome, Source } from "../../types";
import { stripDashes } from "./structure";

/**
 * Claude's first draft of a ticker's thesis, made ONCE (a new ticker gets one on its first run), in Thierry's terms:
 * the market's NARRATIVE (the story the price tells) and the VIEW (why that story is wrong, cracking or turning).
 * Two sentences for Thierry to edit, never a number: no rating, no target, no horizon (Thierry 2026-11-04: « when it
 * calculates numbers they're kind of bullshit »). Reads everything collected: profile, price history, earnings,
 * filings, news, the first draft, Thierry's note and his research folder.
 */

export const RESEARCH_SOURCE = "research";
/** v2 = narrative + view, no call (2026-11-05). A ticker without a v2 draft gets one on its next run. */
export const RESEARCH_PROMPT_VERSION = 2;

export type ResearchThesis = { narrative: string; summary: string };

/** What one draft reads, gathered in `subjects` (which has the database) and handed to the source's fetch. */
export type ResearchEvidence = {
  symbol: string;
  name: string | null;
  position: string | null;
  profile: Record<string, unknown> | null;
  quote: { date: string; close: number; currency: string | null } | null;
  priceHistory: { from: string; to: string; firstClose: number; lastClose: number; high: number; low: number } | null;
  earnings: Record<string, unknown>[];
  filings: { date: string; form: string | null; title: string }[];
  news: { date: string | null; title: string; publisher: string | null }[];
  firstDraft: unknown;
  thierryNote: string | null;
  /** Thierry's own research folder for this company (OneDrive): his models, transcripts, presentations, notes (with text). */
  researchFolder: { path: string; kind: string; modified: string | null; note?: string }[];
};

const prepared = new Map<string, ResearchEvidence>();

/** Tickers without Claude's narrative yet, with their evidence; called by the thesis dimension's `subjects`. */
export async function prepareResearch(db: Db, symbols: string[]): Promise<void> {
  prepared.clear();
  if (symbols.length === 0) return;
  const done = new Set(
    (
      await db
        .select({ subject: facts.subject, sources: facts.sources })
        .from(facts)
        .where(and(eq(facts.dimension, "thesis"), eq(facts.field, "narrative"), inArray(facts.subject, symbols)))
    )
      .filter((f) => f.sources.includes("claude"))
      .map((f) => f.subject),
  );
  for (const symbol of symbols) {
    if (done.has(symbol)) continue;
    prepared.set(symbol, await gatherEvidence(db, symbol));
  }
}

export function preparedResearch(symbol: string): ResearchEvidence | undefined {
  return prepared.get(symbol);
}

async function readPrivateJson(db: Db, file: string): Promise<unknown> {
  const text = await findPrivateFile(db, file);
  return text === null ? null : JSON.parse(text);
}

export async function gatherEvidence(db: Db, symbol: string): Promise<ResearchEvidence> {
  const [profile] = await db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
  const [ticker] = await db.select({ position: gold.tickers.position }).from(gold.tickers).where(eq(gold.tickers.symbol, symbol));
  const [quote] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol));
  const bars = await db
    .select({ date: gold.priceBars.date, close: gold.priceBars.close, high: gold.priceBars.high, low: gold.priceBars.low })
    .from(gold.priceBars)
    .where(eq(gold.priceBars.symbol, symbol))
    .orderBy(desc(gold.priceBars.date))
    .limit(260);
  const earnings = await db.select().from(gold.earnings).where(eq(gold.earnings.symbol, symbol)).orderBy(desc(gold.earnings.period)).limit(8);
  const filings = await db.select().from(gold.filings).where(eq(gold.filings.symbol, symbol)).orderBy(desc(gold.filings.filedAt)).limit(15);
  const folderDocs = await db
    .select()
    .from(onedriveDocuments)
    .where(and(eq(onedriveDocuments.symbol, symbol), eq(onedriveDocuments.savedByDualis, false)))
    .orderBy(desc(onedriveDocuments.modifiedAt))
    .limit(60);
  const news = await db
    .select({ title: goldNewsItems.title, publisher: goldNewsItems.publisher, publishedAt: goldNewsItems.publishedAt })
    .from(goldNewsLinks)
    .innerJoin(goldNewsItems, eq(goldNewsItems.id, goldNewsLinks.newsItemId))
    .where(eq(goldNewsLinks.symbol, symbol))
    .orderBy(desc(goldNewsItems.publishedAt))
    .limit(25);

  const watchlist = (await readPrivateJson(db, "data/watchlist.json")) as { thesis_notes?: Record<string, string> } | null;
  return {
    symbol,
    name: profile?.name ?? null,
    position: ticker?.position ?? null,
    profile: profile
      ? { name: profile.name, exchange: profile.exchange, country: profile.country, sector: profile.sector, industry: profile.industry, marketCap: profile.marketCap, currency: profile.currency, description: profile.description?.slice(0, 1500) ?? null }
      : null,
    quote: quote ? { date: quote.date, close: quote.close, currency: quote.currency } : null,
    priceHistory:
      bars.length > 1
        ? {
            from: bars.at(-1)!.date,
            to: bars[0].date,
            firstClose: bars.at(-1)!.close,
            lastClose: bars[0].close,
            high: Math.max(...bars.map((b) => b.high ?? b.close)),
            low: Math.min(...bars.map((b) => b.low ?? b.close)),
          }
        : null,
    earnings: earnings.map((e) => ({ period: e.period, reportDate: e.reportDate, epsActual: e.epsActual, epsEstimate: e.epsEstimate, revenueActual: e.revenueActual, revenueEstimate: e.revenueEstimate })),
    filings: filings.map((f) => ({ date: f.filedAt.toISOString().slice(0, 10), form: f.form, title: f.title })),
    news: news.map((n) => ({ date: n.publishedAt?.toISOString().slice(0, 10) ?? null, title: n.title, publisher: n.publisher })),
    firstDraft: await readPrivateJson(db, `data/theses/${symbol}.json`),
    thierryNote: watchlist?.thesis_notes?.[symbol] ?? null,
    researchFolder: folderDocs.map((d) => ({
      path: d.path,
      kind: d.kind,
      modified: d.modifiedAt?.toISOString().slice(0, 10) ?? null,
      ...(d.excerpt ? { note: d.excerpt.slice(0, 1500) } : {}),
    })),
  };
}

export const RESEARCH_SYSTEM = `You draft, for an independent equity analyst, the two sentences his thesis on one stock starts from. His method: a share price is the market's narrative about the company; he goes long when a bad narrative is cracking and a better one is about to take over, short when a loved narrative is cracking.
- narrative: the story the market tells today, the one the current price reflects. One plain sentence, the way an investor would say it ("investors see X as Y because Z").
- summary: why that story is wrong, cracking or about to turn, from the evidence. One plain sentence.
Never a number you computed: no rating, no price target, no upside, no valuation. Figures only when the evidence states them (a reported sales figure, a dated event).
"researchFolder" lists the analyst's own research on the company (models, transcripts, notes with their text): build on it. His position on the stock, when given, tells which side he is on.
Plain English, short sentences, no em dash or en dash. Answer with JSON only, no prose, no code fence.`;

export function researchPrompt(e: ResearchEvidence): string {
  return `Stock: ${e.symbol}${e.name ? ` (${e.name})` : ""}${e.position ? `, position: ${e.position}` : ""}

Evidence (JSON):
${JSON.stringify(e)}

Answer with this JSON shape:
{"narrative": "<one sentence>", "summary": "<one sentence>"}`;
}

const str = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} must be a non-empty string`);
  return stripDashes(v.trim());
};

/** Validates Claude's answer; throws with the first reason (the fetch records it as a failed bronze row). */
export function parseResearch(text: string): ResearchThesis {
  const o = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
  return { narrative: str(o.narrative, "narrative"), summary: str(o.summary, "summary") };
}

/** One Claude call per ticker without a draft. The raw answer and the evidence land in bronze. */
export const claudeResearch: Source = {
  name: RESEARCH_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: (symbol) => prepared.has(symbol),
  async fetch(symbol, ctx): Promise<FetchOutcome> {
    const evidence = prepared.get(symbol);
    if (!evidence) throw new Error(`no prepared evidence for ${symbol}`);
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    const { text, model } = await ctx.complete({ system: RESEARCH_SYSTEM, prompt: researchPrompt(evidence) });
    const request = { promptVersion: RESEARCH_PROMPT_VERSION, model: model ?? DEFAULT_MODEL, quote: evidence.quote, evidence };
    try {
      return { request, httpStatus: null, payload: { thesis: parseResearch(text), raw: text } };
    } catch (err) {
      return { request, httpStatus: null, payloadText: text, error: `answer is not the expected JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
