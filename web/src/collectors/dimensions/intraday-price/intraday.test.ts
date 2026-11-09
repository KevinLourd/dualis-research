import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { intradayBars } from "@/db/schema/silver";
import { testDb } from "@/test/db";
import { fetchWindow, promoteIntraday } from "./index";
import { latestTicks, mergeTicks, ticksKnownAt } from "./read";

/** Yahoo chart answer, New York (gmtoffset -5 h): bars at 14:30, 14:35 UTC on Monday 2026-11-09 (09:30, 09:35 local). */
const chart = (closes: (number | null)[], start = Date.parse("2026-11-09T14:30:00Z") / 1000) => ({
  chart: {
    result: [
      {
        meta: { currency: "USD", gmtoffset: -18000 },
        timestamp: closes.map((_, i) => start + i * 300),
        indicators: { quote: [{ open: closes, high: closes, low: closes, close: closes, volume: closes.map(() => 1000) }] },
      },
    ],
  },
});
const fetchOf = (id: string, subject: string, payload: unknown, at: string) =>
  ({ id, dimension: "intraday-price", source: "yahoo", subject, payload, payloadText: null, error: null, fetchedAt: new Date(at) }) as unknown as BronzeFetch;
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

describe("intraday-price", () => {
  it("bronze -> silver (every bar, its bronze id, the exchange's trading day) -> gold; a refetch updates the moving last bar", async () => {
    const { db, close } = await testDb();
    try {
      await promoteIntraday(db, [fetchOf(ID1, "ZZZ", chart([10, null, 10.5]), "2026-11-09T14:41:00Z")]);
      let silver = await db.select().from(intradayBars).orderBy(asc(intradayBars.at));
      expect(silver.map((b) => [b.at.toISOString(), b.date, b.close, b.sources, b.bronzeIds])).toEqual([
        ["2026-11-09T14:30:00.000Z", "2026-11-09", 10, ["yahoo"], [ID1]],
        ["2026-11-09T14:40:00.000Z", "2026-11-09", 10.5, ["yahoo"], [ID1]],
      ]);
      // Next run: the 14:40 bar settled at 10.6, a new bar at 14:45.
      await promoteIntraday(db, [fetchOf(ID2, "ZZZ", chart([10.6, 10.8], Date.parse("2026-11-09T14:40:00Z") / 1000), "2026-11-09T14:51:00Z")]);
      silver = await db.select().from(intradayBars).orderBy(asc(intradayBars.at));
      expect(silver.map((b) => [b.close, b.bronzeIds[0]])).toEqual([[10, ID1], [10.6, ID2], [10.8, ID2]]);
      const g = await db.select().from(gold.intradayBars).orderBy(asc(gold.intradayBars.at));
      expect(g.map((b) => [b.date, b.close, b.sources])).toEqual([["2026-11-09", 10, ["yahoo"]], ["2026-11-09", 10.6, ["yahoo"]], ["2026-11-09", 10.8, ["yahoo"]]]);
      // A Tokyo bar at 00:00 UTC is the Tokyo trading day.
      await promoteIntraday(db, [fetchOf(ID1, "4238.T", { chart: { result: [{ meta: { currency: "JPY", gmtoffset: 32400 }, timestamp: [Date.parse("2026-11-09T00:00:00Z") / 1000], indicators: { quote: [{ close: [1425] }] } }] } }, "2026-11-09T01:00:00Z")]);
      expect((await db.select().from(gold.intradayBars)).find((b) => b.symbol === "4238.T")?.date).toBe("2026-11-09");

      // Lookups: the bar already closed at a moment, and the latest bar.
      const known = await ticksKnownAt(db, [{ symbol: "ZZZ", at: new Date("2026-11-09T14:47:00Z") }, { symbol: "ZZZ", at: new Date("2026-11-09T14:20:00Z") }]);
      expect(known.get("ZZZ")!.map((t) => [t.at.toISOString(), t.close])).toEqual([["2026-11-09T14:40:00.000Z", 10.6]]);
      const ticks = mergeTicks(known, await latestTicks(db, ["ZZZ", "4238.T"]));
      expect(ticks.get("ZZZ")!.map((t) => t.close)).toEqual([10.6, 10.8]);
      expect(ticks.get("4238.T")!.map((t) => t.close)).toEqual([1425]);
    } finally {
      await close();
    }
  });

  it("asks Yahoo from the last stored bar minus a day, else a week before the first signal, never past 59 days", async () => {
    const { db, close } = await testDb();
    try {
      const now = new Date("2026-11-09T12:00:00Z");
      expect((await fetchWindow(db, "ZZZ", new Date("2026-11-05T10:00:00Z"), now)).from.toISOString()).toBe("2026-10-29T10:00:00.000Z");
      expect((await fetchWindow(db, "ZZZ", new Date("2026-01-01T00:00:00Z"), now)).from.toISOString()).toBe("2026-09-11T12:00:00.000Z");
      await promoteIntraday(db, [fetchOf(ID1, "ZZZ", chart([10]), "2026-11-09T14:41:00Z")]);
      expect((await fetchWindow(db, "ZZZ", new Date("2026-11-05T10:00:00Z"), now)).from.toISOString()).toBe("2026-11-08T14:30:00.000Z");
    } finally {
      await close();
    }
  });
});
