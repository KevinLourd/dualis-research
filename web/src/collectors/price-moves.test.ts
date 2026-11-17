import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { priceMoveCauses, priceMoves } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { findMoves, MOVE_Z } from "./dimensions/market-reaction/moves";
import { batchSubject, fundamentalMovesOf, moveCausesSource, movesWithCauses, parseBatch, rebuildMoveCauses } from "./dimensions/move-causes";
import type { SourceContext } from "./types";

/** `n` trading days from 2025-01-01, one a calendar day (weekends do not matter to the maths). */
function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
}

/** A deterministic wobble: small daily returns of +-1% around zero. */
const wobble = (i: number) => 0.01 * Math.sin(i * 1.7) * Math.cos(i * 0.37);

function series(dates: string[], ret: (i: number) => number): { date: string; close: number }[] {
  let close = 100;
  return dates.map((date, i) => {
    if (i > 0) close *= 1 + ret(i);
    return { date, close };
  });
}

describe("significant price moves", () => {
  const dates = days(300);
  const JUMP = 280;

  it("finds a +15% day against a flat S&P 500", () => {
    const bench = series(dates, () => 0);
    const stock = series(dates, (i) => (i === JUMP ? 0.15 : wobble(i)));
    const moves = findMoves("TEST", stock, bench);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: `TEST:${dates[JUMP]}`, startDay: dates[JUMP], endDay: dates[JUMP], days: 1, direction: "up" });
    expect(moves[0].z).toBeGreaterThanOrEqual(MOVE_Z);
    expect(moves[0].returnPct).toBeCloseTo(0.15, 2);
  });

  it("finds nothing when the stock only follows a market-wide drop", () => {
    const market = (i: number) => (i === JUMP ? -0.1 : wobble(i));
    const moves = findMoves("TEST", series(dates, market), series(dates, market));
    expect(moves).toHaveLength(0);
  });

  it("merges consecutive same-sign significant days into one move", () => {
    const bench = series(dates, () => 0);
    const stock = series(dates, (i) => (i === JUMP || i === JUMP + 1 ? -0.12 : wobble(i)));
    const moves = findMoves("TEST", stock, bench);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ startDay: dates[JUMP], endDay: dates[JUMP + 1], days: 2, direction: "down" });
    expect(moves[0].returnPct).toBeCloseTo(0.88 * 0.88 - 1, 3);
  });
});

describe("move causes", () => {
  let db: Db;
  let close: () => Promise<void>;
  let calls: string[];
  const SYMBOL = "TEST";
  const move = (start: string, end = start) => ({ id: `${SYMBOL}:${start}`, symbol: SYMBOL, startDay: start, endDay: end, days: 1, currency: "USD", closeBefore: 10, closeEnd: 11.5, returnPct: 0.15, benchReturn: 0.001, abnormal: 0.149, z: 6, beta: 1, direction: "up" as const });

  const fake: Complete = async ({ prompt }) => {
    calls.push(prompt);
    // The results filing sits under M1; the answer also cites an id nobody listed.
    expect(prompt).toContain("10-Q: Quarterly results");
    return { text: JSON.stringify({ moves: [{ id: "M1", kind: "fundamental", fact: "Quarterly revenue rose 40% on a doubled backlog.", category: "Business economics", cites: ["I1", "I99"], confidence: 0.8 }] }), model: "fake" };
  };
  const ctx = (): SourceContext => ({ env: { CLAUDE_OAUTH_TOKEN: "x" }, fetch, db, complete: fake });

  beforeEach(async () => {
    ({ db, close } = await testDb());
    calls = [];
    await db.insert(priceMoves).values([move("2026-08-06"), move("2021-03-10")]);
    await db.insert(gold.filings).values({ id: "00000000-0000-4000-8000-000000000001", symbol: SYMBOL, registry: "sec", filingKey: "q", form: "10-Q", title: "Quarterly results", filedAt: new Date("2026-08-05T21:00:00Z"), url: "https://example.com/10q", language: "en", sources: ["sec"] });
  });
  afterEach(async () => close());

  it("judges a move with a results filing the day before as fundamental, drops unknown cited ids, and leaves a move with no item unknown without a call", async () => {
    const out = await moveCausesSource.fetch(batchSubject(SYMBOL, [{ startDay: "2026-08-06" }]), ctx());
    expect(out.error).toBeUndefined();
    expect(calls).toHaveLength(1);
    await rebuildMoveCauses(db, [SYMBOL]);
    const causes = new Map((await db.select().from(priceMoveCauses)).map((c) => [c.id, c]));
    const recent = causes.get(`${SYMBOL}:2026-08-06`)!;
    expect(recent).toMatchObject({ kind: "fundamental", category: "Business economics", fact: "Quarterly revenue rose 40% on a doubled backlog.", candidates: 1 });
    expect(recent.cites.map((c) => c.id)).toEqual(["00000000-0000-4000-8000-000000000001"]);
    // No news or filing around the 2021 move: unknown, never asked.
    expect(causes.get(`${SYMBOL}:2021-03-10`)).toMatchObject({ kind: "unknown", fact: null, candidates: 0, judgmentId: null });
    expect(calls).toHaveLength(1);
    // Stored once: the same items never ask again.
    expect(await db.select().from(silver.judgments)).toHaveLength(1);
    expect((await fundamentalMovesOf(db, SYMBOL)).map((m) => m.id)).toEqual([`${SYMBOL}:2026-08-06`]);
    expect((await movesWithCauses(db, SYMBOL)).map((m) => m.id)).toEqual([`${SYMBOL}:2026-08-06`, `${SYMBOL}:2021-03-10`]);
  });

  it("refuses an answer that skips a move or invents a kind", () => {
    const ids = [new Map(), new Map()];
    expect(() => parseBatch(JSON.stringify({ moves: [{ id: "M1", kind: "fundamental" }] }), ids)).toThrow(/M2/);
    expect(() => parseBatch(JSON.stringify({ moves: [{ id: "M1", kind: "vibes" }, { id: "M2", kind: "macro" }] }), ids)).toThrow(/vibes/);
  });
});
