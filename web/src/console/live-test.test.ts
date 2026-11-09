import { describe, expect, it } from "vitest";
import { closeKnownAt, portfolioPnl, positionsFromReadings, signalLabel, type SignalReading } from "./live-test";

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

  it("labels a reading the way Thierry reads it", () => {
    expect(signalLabel("BUY", "weak")).toBe("Weak inflection");
    expect(signalLabel("SELL", "strong")).toBe("Strong crack");
    expect(signalLabel("none", "noise")).toBe("No signal");
  });
});

describe("live test P&L", () => {
  const strongA = { symbol: "A", side: "long" as const, strength: "strong" as const, entryDate: "2026-11-05", exitDate: null, closedAt: null };
  const weakB = { symbol: "B", side: "long" as const, strength: "weak" as const, entryDate: "2026-11-05", exitDate: null, closedAt: null };
  const bars = { A, B };

  it("a strong entry weighs 1 and a weak one the cursor's weight", () => {
    // Day 1: A +10%, B -20%.
    expect(portfolioPnl([strongA, weakB], bars, spx, "2026-11-05", 0.5).lines[0].points[1].value).toBeCloseTo((0.1 - 0.5 * 0.2) / 1.5);
    expect(portfolioPnl([strongA, weakB], bars, spx, "2026-11-05", 1).lines[0].points[1].value).toBeCloseTo((0.1 - 0.2) / 2);
    expect(portfolioPnl([strongA, weakB], bars, spx, "2026-11-05", 0).lines[0].points[1].value).toBeCloseTo(0.1);
  });

  it("rebases the S&P at the close known when the first signal fired, like an entry", () => {
    const pnl = portfolioPnl([strongA], { A, B }, spx, "2026-11-06T08:00:00.000Z", 0.5);
    expect(pnl.lines[1].points[0]).toEqual({ date: "2026-11-05", value: 0 });
    expect(pnl.benchmarkReturn).toBeCloseTo(0.03);
  });

  it("compounds day returns, stops a position at its exit, rebases the S&P at the first signal day", () => {
    const closed = { ...strongA, exitDate: "2026-11-06", closedAt: new Date("2026-11-06T22:00:00Z") };
    const pnl = portfolioPnl([closed], bars, spx, "2026-11-05", 0.5);
    expect(pnl.totalReturn).toBeCloseTo(0.1);
    expect(pnl.benchmarkReturn).toBeCloseTo(0.03);
    const open = portfolioPnl([strongA], bars, spx, "2026-11-05", 0.5);
    expect(open.totalReturn).toBeCloseTo(0.1);
    expect(portfolioPnl([], bars, spx, null, 0.5)).toEqual({ lines: [], totalReturn: 0, benchmarkReturn: null });
  });
});
