import { describe, expect, it } from "vitest";
import { closeKnownAt, portfolioPnl, positionsFromReadings, priceKnownAt, signalLabel, type PnlBenchmark, type SignalReading, type Tick } from "./live-test";

const r = (id: string, at: string, signal: SignalReading["signal"], strength: SignalReading["strength"]): SignalReading => ({ id, signal, strength, at: new Date(at) });
const series = (closes: [string, number][]) => closes.map(([date, close]) => ({ date, close }));
const A = series([["2026-11-05", 100], ["2026-11-06", 110], ["2026-11-09", 121], ["2026-11-10", 110]]);
const B = series([["2026-11-05", 50], ["2026-11-06", 40], ["2026-11-09", 45], ["2026-11-10", 50]]);
const spx = series([["2026-11-05", 1000], ["2026-11-06", 1010], ["2026-11-09", 1020], ["2026-11-10", 1030]]);

describe("live test positions", () => {
  it("trades at the last close printed when the signal fired: Sunday = Friday, US Monday morning = Friday, Tokyo Monday after its close = Monday", () => {
    expect(closeKnownAt(A, new Date("2026-11-08T12:00:00Z"), "US")?.date).toBe("2026-11-06");
    expect(closeKnownAt(A, new Date("2026-11-09T08:00:00Z"), "US")?.date).toBe("2026-11-06");
    expect(closeKnownAt(A, new Date("2026-11-09T08:00:00Z"), "JP")?.date).toBe("2026-11-09");
    expect(closeKnownAt(A, new Date("2026-11-05T08:00:00Z"), "US")).toBeNull();
  });

  it("first BUY opens a long; no signal closes it; an open one is marked to the latest close", () => {
    const [p, q] = positionsFromReadings(
      "A",
      [r("1", "2026-11-05T22:00:00Z", "BUY", "weak"), r("2", "2026-11-09T22:00:00Z", "none", "noise"), r("3", "2026-11-09T23:00:00Z", "SELL", "strong")],
      A,
      "US",
    );
    expect(p).toMatchObject({ id: "1", side: "long", strength: "weak", entryDate: "2026-11-05", entryPrice: 100, exitDate: "2026-11-09", exitPrice: 121 });
    expect(p.return).toBeCloseTo(0.21);
    expect(q).toMatchObject({ id: "3", side: "short", strength: "strong", closedAt: null, entryPrice: 121, markDate: "2026-11-10", markPrice: 110 });
    expect(q.return).toBeCloseTo(1 - 110 / 121);
  });

  it("weak -> strong on the same side closes the weak position and opens a strong one, and back", () => {
    const ps = positionsFromReadings(
      "A",
      [r("1", "2026-11-05T22:00:00Z", "BUY", "weak"), r("2", "2026-11-06T22:00:00Z", "BUY", "strong"), r("3", "2026-11-09T22:00:00Z", "BUY", "weak")],
      A,
      "US",
    );
    expect(ps.map((p) => [p.strength, p.entryPrice, p.exitPrice])).toEqual([["weak", 100, 110], ["strong", 110, 121], ["weak", 121, null]]);
    expect(ps[2].closedAt).toBeNull();
  });

  it("BUY -> SELL closes the long and opens a short at the same close; a ticker never signalled has no position", () => {
    const ps = positionsFromReadings("B", [r("1", "2026-11-05T22:00:00Z", "BUY", "weak"), r("2", "2026-11-06T22:00:00Z", "SELL", "weak")], B, "US");
    expect(ps[0]).toMatchObject({ side: "long", exitPrice: 40 });
    expect(ps[1]).toMatchObject({ side: "short", entryPrice: 40, markPrice: 50 });
    expect(positionsFromReadings("B", [r("1", "2026-11-05T22:00:00Z", "none", "noise")], B, "US")).toEqual([]);
  });

  it("trades at the last 5-minute bar already closed during a session, at the last close when the market is shut", () => {
    // US Monday 2026-11-09: bars at 15:00 and 15:05 UTC.
    const ticks: Tick[] = [
      { at: new Date("2026-11-09T15:00:00Z"), date: "2026-11-09", close: 115 },
      { at: new Date("2026-11-09T15:05:00Z"), date: "2026-11-09", close: 116 },
    ];
    // 15:07: the 15:00 bar is closed (15:05), the 15:05 bar is not (15:10).
    expect(priceKnownAt(A, ticks, new Date("2026-11-09T15:07:00Z"), "US")).toEqual({ price: 115, date: "2026-11-09", at: new Date("2026-11-09T15:05:00Z"), source: "intraday" });
    // Sunday: Friday's close, newer than nothing intraday.
    expect(priceKnownAt(A, ticks, new Date("2026-11-08T12:00:00Z"), "US")).toMatchObject({ price: 110, date: "2026-11-06", source: "close" });
    // After Monday's close: the close (21:00) is newer than the last bar (15:10).
    expect(priceKnownAt(A, ticks, new Date("2026-11-09T22:00:00Z"), "US")).toMatchObject({ price: 121, date: "2026-11-09", source: "close" });
  });

  it("a position opened and closed in the same session reads the move between its two 5-minute prices, not 0%", () => {
    const ticks: Tick[] = [
      { at: new Date("2026-11-09T15:00:00Z"), date: "2026-11-09", close: 115 },
      { at: new Date("2026-11-09T19:00:00Z"), date: "2026-11-09", close: 126.5 },
      { at: new Date("2026-11-09T20:55:00Z"), date: "2026-11-09", close: 121 },
    ];
    const [p, q] = positionsFromReadings(
      "A",
      [r("1", "2026-11-09T15:10:00Z", "BUY", "strong"), r("2", "2026-11-09T19:30:00Z", "SELL", "weak")],
      A.slice(0, 2),
      "US",
      ticks,
    );
    expect(p).toMatchObject({ entryPrice: 115, entrySource: "intraday", exitPrice: 126.5, exitSource: "intraday", exitDate: "2026-11-09" });
    expect(p.return).toBeCloseTo(0.1);
    // Open short marked to the latest bar (no daily bar for Monday stored yet).
    expect(q).toMatchObject({ entryPrice: 126.5, markPrice: 121, markSource: "intraday", markDate: "2026-11-09" });
    expect(q.return).toBeCloseTo(1 - 121 / 126.5);
  });

  it("labels a reading the way Thierry reads it", () => {
    expect(signalLabel("BUY", "weak")).toBe("Weak inflection");
    expect(signalLabel("SELL", "strong")).toBe("Strong crack");
    expect(signalLabel("none", "noise")).toBe("No signal");
  });
});

describe("live test P&L", () => {
  const base = { entryPrice: 100, exitDate: null, exitPrice: null, markDate: null, markPrice: null, closedAt: null };
  const strongA = { ...base, symbol: "A", side: "long" as const, strength: "strong" as const, entryDate: "2026-11-05" };
  const weakB = { ...base, symbol: "B", side: "long" as const, strength: "weak" as const, entryDate: "2026-11-05", entryPrice: 50 };
  const bars = { A, B };
  const bench = (b: PnlBenchmark["base"], mark: PnlBenchmark["mark"] = null): PnlBenchmark => ({ bars: spx, base: b, mark });
  const spxAtClose = bench({ price: 1000, date: "2026-11-05", source: "close" });

  it("a strong entry weighs 1 and a weak one the cursor's weight", () => {
    // Day 1: A +10%, B -20%. Points: 11-05 (entry at the close: 0), 11-06.
    expect(portfolioPnl([strongA, weakB], bars, spxAtClose, 0.5).lines[0].points[1].value).toBeCloseTo((0.1 - 0.5 * 0.2) / 1.5);
    expect(portfolioPnl([strongA, weakB], bars, spxAtClose, 1).lines[0].points[1].value).toBeCloseTo((0.1 - 0.2) / 2);
    expect(portfolioPnl([strongA, weakB], bars, spxAtClose, 0).lines[0].points[1].value).toBeCloseTo(0.1);
  });

  it("counts the entry day from the entry price and the exit day to the exit price", () => {
    // Bought Friday 11-06 mid-session at 105 (close 110), sold Monday mid-session at 115.5.
    const p = { ...strongA, entryDate: "2026-11-06", entryPrice: 105, exitDate: "2026-11-09", exitPrice: 115.5, closedAt: new Date("2026-11-09T18:00:00Z") };
    const pnl = portfolioPnl([p], bars, spxAtClose, 0.5);
    expect(pnl.lines[0].points[0]).toEqual({ date: "2026-11-05", value: 0 });
    expect(pnl.totalReturn).toBeCloseTo(0.1);
  });

  it("marks an open position to its latest 5-minute price on the mark day", () => {
    const p = { ...strongA, entryDate: "2026-11-09", entryPrice: 120, markDate: "2026-11-11", markPrice: 132 };
    expect(portfolioPnl([p], bars, spxAtClose, 0.5).totalReturn).toBeCloseTo(0.1);
  });

  it("S&P bought during a session starts the day before; bought at a close starts that day; marked to its latest price", () => {
    const mid = portfolioPnl([strongA], bars, bench({ price: 1005, date: "2026-11-06", source: "intraday" }, { price: 1035, date: "2026-11-11" }), 0.5);
    expect(mid.lines[1].points[0]).toEqual({ date: "2026-11-05", value: 0 });
    expect(mid.lines[1].points[1].value).toBeCloseTo(1010 / 1005 - 1);
    expect(mid.benchmarkReturn).toBeCloseTo(1035 / 1005 - 1);
    const shut = portfolioPnl([strongA], bars, spxAtClose, 0.5);
    expect(shut.lines[1].points[0]).toEqual({ date: "2026-11-05", value: 0 });
    expect(shut.benchmarkReturn).toBeCloseTo(0.03);
  });

  it("compounds day returns and stops a position at its exit", () => {
    const closed = { ...strongA, exitDate: "2026-11-06", exitPrice: 110, closedAt: new Date("2026-11-06T22:00:00Z") };
    expect(portfolioPnl([closed], bars, spxAtClose, 0.5).totalReturn).toBeCloseTo(0.1);
    expect(portfolioPnl([strongA], bars, spxAtClose, 0.5).totalReturn).toBeCloseTo(0.1);
    expect(portfolioPnl([], bars, bench(null), 0.5)).toEqual({ lines: [], totalReturn: 0, benchmarkReturn: null });
  });
});
