import { evidence, narrativeDrivers, narratives, signalChanges, signals } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";

/** One analysed ticker with the analysis objects the Ideas read: signal, fair value, narrative, a driver, evidence, a Signal Change. */
export async function seedAnalysedTicker(db: Db, symbol = "CCLD", opts: { name?: string; evidenceHeadline?: string } = {}) {
  const now = new Date();
  await db.insert(gold.tickers).values({ symbol, market: "US", aliases: [], inPortfolio: false, analysed: true, position: "long" });
  await db.insert(gold.companyProfiles).values({ symbol, name: opts.name ?? `${symbol} Inc.`, provenance: {} });
  await db.insert(signals).values({
    symbol, signal: "BUY", strength: "strong", fairValue: 6, fairValueMethod: "m", fairValueLabel: "8x EV/EBITDA", currency: "USD",
    quote: 4, quoteDate: now.toISOString().slice(0, 10), gapPct: -1 / 3, evidenceIds: [`${symbol}|news:n1`], since: now,
  });
  await db.insert(narratives).values({ symbol, text: `The market thinks ${symbol} lost its biggest client.`, detail: "Detail.", version: crypto.randomUUID(), asOf: now });
  await db.insert(narrativeDrivers).values({ id: `${symbol}:1`, symbol, rank: 1, category: "Business economics", title: "Client loss", summary: "Revenue fell 20%.", text: "Long text.", version: crypto.randomUUID() });
  await db.insert(evidence).values({
    id: `${symbol}|news:n1`, symbol, driverId: `${symbol}:1`, effect: "reversal", strength: "strong", probability: 0.9, why: "A new client replaces the lost one.",
    citedSentence: null, exhibitId: null, kind: "news", headline: opts.evidenceHeadline ?? `${symbol} signs a new hospital client`, url: "https://news.example/n1", publisher: "Reuters",
    eventDay: now.toISOString().slice(0, 10), eventAt: new Date(now.getTime() - 3600_000), judgmentId: crypto.randomUUID(), verdicts: [],
  });
  const changeId = crypto.randomUUID();
  await db.insert(signalChanges).values({ id: changeId, symbol, fromSignal: "none", toSignal: "BUY", fromStrength: "noise", toStrength: "strong", at: now, updateNote: "The new client turns the story.", evidenceIds: [] });
  return { changeId };
}
