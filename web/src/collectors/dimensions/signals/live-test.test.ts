import { describe, expect, it } from "vitest";
import type { BronzeFetch } from "@/db/schema/bronze";
import { liveBenchmark, livePositions, signalEvents } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { promoteSignals, type SignalReading } from "./index";

const reading = (signal: SignalReading["signal"], strength: SignalReading["strength"]): SignalReading => ({
  signal,
  strength,
  side: signal === "SELL" ? "short" : signal === "BUY" ? "long" : null,
  why: null,
  theses: [],
  evidenceIds: [],
  fairValue: null,
  fairValueMethod: null,
  currency: "USD",
  quote: null,
  quoteDate: null,
  gapPct: null,
});
const fetchOf = (r: SignalReading, at: Date) => ({ subject: "ZZZ", payload: r, fetchedAt: at, error: null }) as unknown as BronzeFetch;
const complete = (async () => ({ text: "Note.", model: "test" })) as unknown as Complete;

describe("signals: live test events and positions", () => {
  it("stores every reading as an event and opens / closes a position at the close known at each signal", async () => {
    const { db, close } = await testDb();
    try {
      await db.insert(gold.tickers).values({ symbol: "ZZZ", market: "US", aliases: [], inPortfolio: false, analysed: true, position: "watch" });
      await db.insert(gold.priceBars).values(
        [["2026-11-05", 10], ["2026-11-06", 11], ["2026-11-09", 12]].map(([date, close]) => ({ symbol: "ZZZ", date: date as string, close: close as number, sources: ["test"], alternatives: [] })),
      );
      await db.insert(gold.quotes).values({ symbol: "ZZZ", date: "2026-11-09", close: 12, currency: "USD", sources: ["test"] });

      // Saturday: weak BUY (Friday's close, 11). Monday after the US close: strong BUY closes the weak, opens a strong at 12.
      const sat = new Date("2026-11-07T10:00:00Z");
      const mon = new Date("2026-11-09T22:00:00Z");
      await promoteSignals(db, [fetchOf(reading("BUY", "weak"), sat)], complete, sat);
      await promoteSignals(db, [fetchOf(reading("BUY", "strong"), mon)], complete, mon);

      const events = await db.select().from(signalEvents).orderBy(signalEvents.at);
      expect(events.map((e) => [e.signal, e.strength, e.fromSignal, e.fromStrength])).toEqual([
        ["BUY", "weak", null, null],
        ["BUY", "strong", "BUY", "weak"],
      ]);
      const positions = await db.select().from(livePositions).orderBy(livePositions.openedAt);
      expect(positions).toHaveLength(2);
      expect(positions[0]).toMatchObject({ side: "long", strength: "weak", entryDate: "2026-11-06", entryPrice: 11, exitDate: "2026-11-09", exitPrice: 12, currency: "USD" });
      expect(positions[0].return).toBeCloseTo(12 / 11 - 1);
      expect(positions[1]).toMatchObject({ strength: "strong", closedAt: null, entryPrice: 12, markPrice: 12, return: 0 });
    } finally {
      await close();
    }
  });

  it("trades at the 5-minute price of the minute a signal lands during a session, and buys the S&P 500 the same way", async () => {
    const { db, close } = await testDb();
    try {
      await db.insert(gold.tickers).values({ symbol: "ZZZ", market: "US", aliases: [], inPortfolio: false, analysed: true, position: "watch" });
      await db.insert(gold.priceBars).values(
        [["ZZZ", "2026-11-06", 11], ["^GSPC", "2026-11-06", 1000]].map(([symbol, date, close]) => ({ symbol: symbol as string, date: date as string, close: close as number, sources: ["test"], alternatives: [] })),
      );
      await db.insert(gold.quotes).values({ symbol: "ZZZ", date: "2026-11-06", close: 11, currency: "USD", sources: ["test"] });
      const bar = (symbol: string, at: string, close: number) => ({ symbol, at: new Date(at), date: "2026-11-09", close, sources: ["yahoo"] });
      await db.insert(gold.intradayBars).values([
        bar("ZZZ", "2026-11-09T15:00:00Z", 12),
        bar("ZZZ", "2026-11-09T18:00:00Z", 13.2),
        bar("ZZZ", "2026-11-09T19:00:00Z", 12.5),
        bar("^GSPC", "2026-11-09T15:00:00Z", 1010),
        bar("^GSPC", "2026-11-09T19:00:00Z", 1020),
      ]);
      // Monday 15:10 UTC: BUY at the 15:00 bar (12). 18:10: no signal, exit at the 18:00 bar (13.2).
      const buy = new Date("2026-11-09T15:10:00Z");
      const none = new Date("2026-11-09T18:10:00Z");
      await promoteSignals(db, [fetchOf(reading("BUY", "strong"), buy)], complete, buy);
      await promoteSignals(db, [fetchOf(reading("none", "noise"), none)], complete, none);
      const [p] = await db.select().from(livePositions);
      expect(p).toMatchObject({ entryPrice: 12, entrySource: "intraday", entryDate: "2026-11-09", exitPrice: 13.2, exitSource: "intraday", exitDate: "2026-11-09" });
      expect(p.entryAt?.toISOString()).toBe("2026-11-09T15:05:00.000Z");
      expect(p.return).toBeCloseTo(0.1);
      const [spx] = await db.select().from(liveBenchmark);
      expect(spx).toMatchObject({ symbol: "^GSPC", basePrice: 1010, baseSource: "intraday", markPrice: 1020, markSource: "intraday" });
    } finally {
      await close();
    }
  });
});
