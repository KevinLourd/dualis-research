import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driverConfidence, narrativeDrivers, narratives, priceMoveCauses, priceMoves } from "@/db/schema/analysis";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import * as silver from "@/db/schema/silver";
import { testDb } from "@/test/db";
import { confidentDriverIds, confidencePrompt, driverConfidenceSource, parseConfidence, rebuildDriverConfidence, testedMoves } from "./dimensions/driver-confidence";
import { movesWithCauses } from "./dimensions/move-causes";
import { noConfidentDriver } from "./dimensions/narrative-state";
import type { SourceContext } from "./types";

/** Narrative Driver Temporal Confidence (Kevin 2026-11-19): does the market keep trading the stock on this reason? */

const SYMBOL = "101160.KQ";
const move = (day: string, ret: number) => ({ id: `${SYMBOL}:${day}`, symbol: SYMBOL, startDay: day, endDay: day, days: 1, currency: "KRW", closeBefore: 100, closeEnd: 100 * (1 + ret), returnPct: ret, benchReturn: 0, abnormal: ret, z: ret * 30, beta: 1, direction: ret > 0 ? ("up" as const) : ("down" as const) });
const cause = (day: string, kind: "fundamental" | "macro", fact: string) => ({
  id: `${SYMBOL}:${day}`,
  symbol: SYMBOL,
  kind,
  fact,
  category: kind === "fundamental" ? ("Business economics" as const) : null,
  cites: [],
  candidates: 1,
  confidence: 0.8,
  metric: kind === "fundamental" ? { series: "qmetric:operating-margin", label: "Operating margin (quarterly)", period: "2025-09", from: "9%", to: "16%", change: "+7 pts" } : null,
  lasting: kind === "fundamental" ? ("structural" as const) : ("n-a" as const),
  judgmentId: "00000000-0000-4000-8000-0000000000aa",
});

describe("driver confidence", () => {
  let db: Db;
  let close: () => Promise<void>;
  let prompts: string[];

  beforeEach(async () => {
    ({ db, close } = await testDb());
    prompts = [];
    await db.insert(silver.tickers).values({ symbol: SYMBOL, market: "KR", sources: ["watchlist"], bronzeIds: [] });
    await db.insert(priceMoves).values([move("2023-08-11", 0.107), move("2024-08-05", -0.126), move("2025-11-14", -0.113), move("2026-02-25", 0.107)]);
    await db.insert(priceMoveCauses).values([
      cause("2023-08-11", "fundamental", "Operating margin jumped on cheaper inputs."),
      cause("2024-08-05", "macro", "Korean market crash."),
      cause("2025-11-14", "fundamental", "Q3 operating profit fell 40%."),
      cause("2026-02-25", "fundamental", "Sales and profit structure changed by 30%."),
    ]);
    await db.insert(narratives).values({ id: `${SYMBOL}:long`, symbol: SYMBOL, side: "long", text: "The market sees Worldex as a cash-rich maker whose profits are sliding.", detail: null, version: "v1", asOf: new Date() });
    await db.insert(narrativeDrivers).values([
      { id: `${SYMBOL}:long:1`, symbol: SYMBOL, side: "long", rank: 1, category: "Business economics", title: "Profits peaked in 2024 and fell", summary: null, text: "Operating margin fell from 16% to 9%.", moveIds: [`${SYMBOL}:2023-08-11`], version: "v1" },
      { id: `${SYMBOL}:long:2`, symbol: SYMBOL, side: "long", rank: 2, category: "Balance sheet & capital", title: "Cash pile earns little credit", summary: null, text: "Net cash covers half the market cap.", moveIds: [], version: "v1" },
    ]);
  });
  afterEach(async () => close());

  it("tests a driver on the business moves after its origin only, macro moves left out", async () => {
    const moves = await movesWithCauses(db, SYMBOL);
    expect(testedMoves({ moveIds: [`${SYMBOL}:2023-08-11`] }, moves).map((m) => m.startDay)).toEqual(["2025-11-14", "2026-02-25"]);
    // A driver that cites no move is tested on every business move.
    expect(testedMoves({ moveIds: [] }, moves).map((m) => m.startDay)).toEqual(["2023-08-11", "2025-11-14", "2026-02-25"]);
  });

  it("asks once per thesis, keeps only the moves each driver was tested on, and lets only strong and weak drivers signal", async () => {
    const fake: Complete = async ({ prompt }) => {
      prompts.push(prompt);
      expect(prompt).toContain("Operating margin (quarterly) 9% to 16% (+7 pts)");
      expect(prompt).not.toContain("Korean market crash");
      expect(prompt).toContain("Left out: 1 moves");
      return {
        text: JSON.stringify({
          drivers: [
            { id: "D1", level: "strong", reason: "Margin news moved the stock twice after its 2023 origin, the way the story says.", moves: [{ id: "M2", fit: "explains", why: "Profit fell 40%" }, { id: "M3", fit: "explains", why: "Profit structure changed" }, { id: "M1", fit: "explains", why: "its own origin" }] },
            { id: "D2", level: "noise", reason: "No business move was about the cash pile.", moves: [{ id: "M1", fit: "unrelated", why: "about margins" }] },
          ],
        }),
        model: "fake",
      };
    };
    const ctx: SourceContext = { env: { CLAUDE_OAUTH_TOKEN: "x" }, fetch, db, complete: fake };
    const out = await driverConfidenceSource.fetch(`${SYMBOL}:long`, ctx);
    expect(out.error).toBeUndefined();
    expect(prompts).toHaveLength(1);
    await rebuildDriverConfidence(db);
    const rows = new Map((await db.select().from(driverConfidence)).map((r) => [r.id, r]));
    const d1 = rows.get(`${SYMBOL}:long:1`)!;
    expect(d1.level).toBe("strong");
    // M1 is its origin, not a test: dropped.
    expect(d1.rows.map((r) => r.day)).toEqual(["2025-11-14", "2026-02-25"]);
    expect(d1).toMatchObject({ explained: 2, contradicted: 0, tested: 2, originMoveIds: [`${SYMBOL}:2023-08-11`] });
    expect(d1.rows[0].metric?.series).toBe("qmetric:operating-margin");
    expect(rows.get(`${SYMBOL}:long:2`)!.level).toBe("noise");
    expect([...(await confidentDriverIds(db, SYMBOL))]).toEqual([`${SYMBOL}:long:1`]);
  });

  it("refuses an answer that skips a driver or invents a level or fit", async () => {
    const moves = await movesWithCauses(db, SYMBOL);
    const drivers = (await db.select().from(narrativeDrivers)).sort((a, b) => a.rank - b.rank);
    const { moveIds, tested } = confidencePrompt(SYMBOL, "long", "x", drivers, moves);
    const ok = { id: "D2", level: "weak", reason: "Too few moves.", moves: [] };
    expect(() => parseConfidence(JSON.stringify({ drivers: [ok] }), drivers, moveIds, tested)).toThrow(/D1/);
    expect(() => parseConfidence(JSON.stringify({ drivers: [{ ...ok, id: "D1", level: "maybe" }, ok] }), drivers, moveIds, tested)).toThrow(/maybe/);
    expect(() => parseConfidence(JSON.stringify({ drivers: [{ ...ok, id: "D1", moves: [{ id: "M2", fit: "kinda" }] }, ok] }), drivers, moveIds, tested)).toThrow(/kinda/);
  });

  it("a thesis with no trusted driver is noise with no call and no signal", () => {
    const p = noConfidentDriver(SYMBOL, "long");
    expect(p.drivers).toEqual([]);
    expect(p.thesis).toMatchObject({ verdict: "noise", signal: "noise", judgmentId: null });
  });
});
