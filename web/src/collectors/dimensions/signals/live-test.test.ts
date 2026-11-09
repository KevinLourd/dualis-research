import { describe, expect, it } from "vitest";
import type { BronzeFetch } from "@/db/schema/bronze";
import { livePositions, signalEvents } from "@/db/schema/analysis";
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
});
