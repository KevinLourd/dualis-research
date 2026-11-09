import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { BENCHMARK } from "@/collectors/benchmark";
import { getDb } from "@/db/client";
import { signalStates } from "@/db/schema/analysis";
import { companyProfiles, priceBars, quotes, tickers } from "@/db/schema/gold";
import { replayStrategy, type SignalState, type StrategyId } from "./live-test";
import type { Bar } from "./portfolio-series";

/**
 * Live test page: the analysed tickers' signal history and their closes since the first signal, replayed per strategy.
 * Reads only from the first signal day on (Neon egress rule), never the Portfolio page's positions.
 */
export async function liveTestView(strategy: StrategyId) {
  const db = getDb();
  const analysed = db.select({ symbol: tickers.symbol }).from(tickers).where(eq(tickers.analysed, true));
  const [states, names] = await Promise.all([
    db
      .select({ symbol: signalStates.symbol, signal: signalStates.signal, strength: signalStates.strength, at: signalStates.at })
      .from(signalStates)
      .where(inArray(signalStates.symbol, analysed))
      .orderBy(asc(signalStates.at)),
    db
      .select({ symbol: tickers.symbol, name: companyProfiles.name, currency: quotes.currency, profileCurrency: companyProfiles.currency })
      .from(tickers)
      .leftJoin(companyProfiles, eq(companyProfiles.symbol, tickers.symbol))
      .leftJoin(quotes, eq(quotes.symbol, tickers.symbol))
      .where(eq(tickers.analysed, true)),
  ]);
  const start = states[0]?.at.toISOString().slice(0, 10) ?? null;
  const traded = [...new Set(states.filter((s) => s.signal !== "none").map((s) => s.symbol))];
  const rows = start
    ? await db
        .select({ symbol: priceBars.symbol, date: priceBars.date, close: priceBars.close })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, [...traded, BENCHMARK]), gte(priceBars.date, start)))
        .orderBy(asc(priceBars.date))
    : [];
  const bars = new Map<string, Bar[]>();
  for (const b of rows) bars.set(b.symbol, [...(bars.get(b.symbol) ?? []), { date: b.date, close: b.close }]);
  const result = replayStrategy(states as SignalState[], bars, bars.get(BENCHMARK) ?? [], strategy);
  const meta = new Map(names.map((n) => [n.symbol, { name: n.name, currency: n.currency ?? n.profileCurrency }]));
  return { start, ...result, meta };
}
