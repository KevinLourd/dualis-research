import { cache } from "react";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { evidenceStrength, type SignalCall, type SignalStrength } from "@/content/signal-words";
import { getDb } from "@/db/client";
import { evidence as goldEvidence, exhibits, fairValues, marketReactions, narrativeDrivers, narrativeStates, signals, type ThesisSide } from "@/db/schema/analysis";
import { goldCatalysts } from "@/db/schema/catalysts";
import { consensus } from "@/db/schema/consensus";
import { companyProfiles, filings, priceBars, quotes, tickers } from "@/db/schema/gold";
import { goldNewsItems } from "@/db/schema/news";

/**
 * The 3 console levels (Kevin 2026-11-05): A) the Signals board, B) one ticker's analysis (panel or page),
 * C) one item's detail with its sources. Gold only. Signal, strength and fair value are the analysis objects
 * (gold.signals, built by the `signals` dimension); a ticker not analysed yet shows no call and Noise.
 */

export type BoardRow = {
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  position: string;
  inPortfolio: boolean;
  /** In the analysis scope; false = Inactive tab (name and quote only, nothing analysed). */
  analysed: boolean;
  fairValue: number | null;
  fairValueMethod: string | null;
  /** The method in a few words ("5.9x EV/EBITDA, 4-year median"); the full calculation stays in the item panel. */
  fairValueLabel: string | null;
  fairValueCurrency: string | null;
  close: number | null;
  currency: string | null;
  quoteDate: string | null;
  gap: { pct: number; side: "below" | "above" } | null;
  call: SignalCall | null;
  strength: SignalStrength;
  /** The ticker's tag as shown (Kevin 2026-11-06: "Weak inflection", never a bare "Weak"): the signal's reversal, else its only thesis' tag. */
  tag: { effect: string; strength: string } | null;
  /** The thesis the tag reads on (long = Inflection, short = Crack): the signalling one, else the only one; null when two compete silently. */
  side: ThesisSide | null;
  since: Date | null;
};

async function readBoard(symbol?: string): Promise<BoardRow[]> {
  const rows = await getDb()
    .select({
      symbol: tickers.symbol,
      position: tickers.position,
      inPortfolio: tickers.inPortfolio,
      analysed: tickers.analysed,
      name: companyProfiles.name,
      logoUrl: companyProfiles.logoUrl,
      profileCurrency: companyProfiles.currency,
      close: quotes.close,
      quoteCurrency: quotes.currency,
      quoteDate: quotes.date,
      signal: signals,
    })
    .from(tickers)
    .leftJoin(companyProfiles, eq(companyProfiles.symbol, tickers.symbol))
    .leftJoin(quotes, eq(quotes.symbol, tickers.symbol))
    .leftJoin(signals, eq(signals.symbol, tickers.symbol))
    .where(symbol ? eq(tickers.symbol, symbol) : undefined)
    .orderBy(asc(tickers.symbol));
  return rows.map((r) => {
    const s = r.signal;
    // The quote the signal was judged on, so the call, the gap and the price shown always agree.
    const close = s?.quote ?? r.close;
    const only = s && s.theses.length === 1 ? s.theses[0] : null;
    return {
      symbol: r.symbol,
      name: r.name,
      logoUrl: r.logoUrl,
      position: r.position,
      inPortfolio: r.inPortfolio,
      analysed: r.analysed,
      fairValue: s?.fairValue ?? null,
      fairValueMethod: s?.fairValueMethod ?? null,
      fairValueLabel: s?.fairValueLabel ?? null,
      fairValueCurrency: s?.currency ?? r.quoteCurrency ?? r.profileCurrency,
      close,
      currency: s?.currency ?? r.quoteCurrency ?? r.profileCurrency,
      quoteDate: s?.quoteDate ?? r.quoteDate,
      gap: s?.gapPct === null || s?.gapPct === undefined ? null : { pct: Math.abs(s.gapPct), side: s.gapPct < 0 ? "below" : "above" },
      call: s && s.signal !== "none" ? s.signal : null,
      strength: s?.strength ?? "noise",
      tag: s && s.signal !== "none" ? { effect: "reversal", strength: s.strength } : only ? { effect: only.effect, strength: only.strength } : null,
      side: s?.side ?? only?.side ?? null,
      since: s?.since ?? null,
    };
  });
}

const ORDER: Record<SignalStrength, number> = { strong: 0, weak: 1, noise: 2 };

/** Level A: the analysed watchlist tickers but the portfolio (it has its own page), strongest first. */
export async function signalBoard(): Promise<BoardRow[]> {
  const rows = (await readBoard()).filter((r) => !r.inPortfolio && r.analysed);
  return rows.sort((a, b) => ORDER[a.strength] - ORDER[b.strength] || Number(b.call !== null) - Number(a.call !== null) || a.symbol.localeCompare(b.symbol));
}

/** Inactive tab: watchlist tickers outside the analysis scope, for information only (name, quote; nothing analysed). */
export async function inactiveBoard(): Promise<BoardRow[]> {
  return (await readBoard()).filter((r) => !r.inPortfolio && !r.analysed);
}

/** Level A's row for one ticker (header of the panel and of the Analysis page). */
export const boardRowOf = cache(async (symbol: string): Promise<BoardRow | null> => (await readBoard(symbol))[0] ?? null);

/** Level C: one judged news / filing, every article and filing behind it, with their sources. */
export async function evidenceDetail(symbol: string, id: string) {
  const db = getDb();
  const [own] = await db.select().from(goldEvidence).where(and(eq(goldEvidence.symbol, symbol), eq(goldEvidence.id, id)));
  // Evidence (every news item and filing of the year, judged against a driver) carries its own item; older ids are catalysts.
  const [legacy] = own ? [] : await db.select().from(goldCatalysts).where(and(eq(goldCatalysts.symbol, symbol), eq(goldCatalysts.id, id)));
  const catalyst = own
    ? {
        id: own.id,
        symbol: own.symbol,
        kind: own.kind,
        eventDay: own.eventDay,
        eventAt: own.eventAt,
        direction: (own.effect === "reversal" ? "contradicts" : "continues") as "contradicts" | "continues",
        probability: own.probability,
        reason: own.why,
        evidence: own.citedSentence,
        headline: own.headline,
        url: own.url,
        publisher: own.publisher,
        newsItemIds: own.newsItemIds,
        filingIds: own.filingIds,
        sources: own.sources,
        rebuiltAt: own.rebuiltAt,
      }
    : legacy;
  if (!catalyst) return null;
  const [articles, docs, [judged]] = await Promise.all([
    catalyst.newsItemIds.length ? db.select().from(goldNewsItems).where(inArray(goldNewsItems.id, catalyst.newsItemIds)).orderBy(desc(goldNewsItems.publishedAt)) : [],
    catalyst.filingIds.length ? db.select().from(filings).where(inArray(filings.id, catalyst.filingIds)).orderBy(desc(filings.filedAt)) : [],
    db.select().from(goldEvidence).where(eq(goldEvidence.id, id)),
  ]);
  const [[driver], [exhibit], drivers, [reaction]] = await Promise.all([
    judged?.driverId ? db.select().from(narrativeDrivers).where(eq(narrativeDrivers.id, judged.driverId)) : [],
    judged?.exhibitId ? db.select().from(exhibits).where(eq(exhibits.id, judged.exhibitId)) : [],
    judged ? db.select().from(narrativeDrivers).where(eq(narrativeDrivers.symbol, symbol)).orderBy(asc(narrativeDrivers.side), asc(narrativeDrivers.rank)) : [],
    db.select().from(marketReactions).where(eq(marketReactions.id, id)),
  ]);
  return {
    catalyst,
    // Judged against a Narrative Driver (gold.evidence) when the ticker has drivers; else the narrative-level judgment.
    evidence: judged ?? null,
    driver: driver ?? null,
    /** Every driver of the ticker's theses, to show the item's verdict against each. */
    drivers,
    /** What the price did around the item, and the fair value then and now. */
    reaction: reaction ?? null,
    exhibit: exhibit ?? null,
    strength: judged?.strength ?? evidenceStrength(catalyst.direction, catalyst.probability),
    articles,
    filings: docs,
  };
}

/** Level C: one KPI vs consensus over every period. */
export async function kpiDetail(symbol: string, metric: string) {
  return getDb()
    .select()
    .from(consensus)
    .where(and(eq(consensus.symbol, symbol), eq(consensus.metric, metric)))
    .orderBy(asc(consensus.periodType), asc(consensus.periodEnd));
}

/** Level C: the price history behind the quote (one year), oldest first. */
export async function priceDetail(symbol: string) {
  return getDb().select().from(priceBars).where(eq(priceBars.symbol, symbol)).orderBy(asc(priceBars.date));
}

/** Level C: one Narrative Driver with its exhibits, its tag, and every news whose verdict against IT is not noise. */
export async function driverDetail(symbol: string, id: string) {
  const db = getDb();
  const [[driver], xs, ev, [state], reactions] = await Promise.all([
    db.select().from(narrativeDrivers).where(and(eq(narrativeDrivers.symbol, symbol), eq(narrativeDrivers.id, id))),
    db.select().from(exhibits).where(eq(exhibits.driverId, id)).orderBy(asc(exhibits.rank)),
    db.select().from(goldEvidence).where(eq(goldEvidence.symbol, symbol)).orderBy(desc(goldEvidence.eventAt)),
    db.select().from(narrativeStates).where(eq(narrativeStates.id, id)),
    db.select().from(marketReactions).where(eq(marketReactions.symbol, symbol)),
  ]);
  return driver ? { driver, exhibits: xs, evidence: ev.filter((e) => e.verdicts.some((v) => v.driverId === id && v.effect !== "noise")), state: state ?? null, side: driver.side, reactions: new Map(reactions.map((r) => [r.id, r])) } : null;
}

/** Level C: one Exhibit and the driver it supports. */
export async function exhibitDetail(symbol: string, id: string) {
  const db = getDb();
  const [exhibit] = await db.select().from(exhibits).where(and(eq(exhibits.symbol, symbol), eq(exhibits.id, id)));
  if (!exhibit) return null;
  const [driver] = await db.select().from(narrativeDrivers).where(eq(narrativeDrivers.id, exhibit.driverId));
  return { exhibit, driver: driver ?? null };
}

/**
 * The price vs fair value chart above the Narrative: every daily close (gold.price_bars, oldest first) and the current
 * Fair Value (gold.fair_values: Thierry's number when he typed one, Claude's kept beside it). Gold keeps no past fair
 * values, so the line starts at the date the current one was set.
 */
export const priceVsFairValue = cache(async (symbol: string) => {
  const db = getDb();
  const [bars, [fair]] = await Promise.all([
    db.select({ date: priceBars.date, close: priceBars.close, sources: priceBars.sources }).from(priceBars).where(eq(priceBars.symbol, symbol)).orderBy(asc(priceBars.date)),
    db.select().from(fairValues).where(eq(fairValues.symbol, symbol)),
  ]);
  return {
    bars: bars.map((b) => ({ date: b.date, close: b.close })),
    sources: [...new Set(bars.flatMap((b) => b.sources))],
    fair:
      fair && fair.value !== null
        ? {
            value: fair.value,
            currency: fair.currency,
            author: fair.author,
            since: fair.asOf ? fair.asOf.toISOString().slice(0, 10) : null,
            claudeValue: fair.author === "thierry" ? fair.claudeValue : null,
            low: fair.low,
            high: fair.high,
          }
        : null,
  };
});
export type PriceVsFairValue = Awaited<ReturnType<typeof priceVsFairValue>>;

/** Level C: how the fair value was set (gold.fair_values): who, the method, every input. */
export async function fairValueDetail(symbol: string) {
  const [row] = await getDb().select().from(fairValues).where(eq(fairValues.symbol, symbol));
  return row ?? null;
}
