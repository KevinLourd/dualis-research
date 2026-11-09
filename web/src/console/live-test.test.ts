import { describe, expect, it } from "vitest";
import { replayStrategy, type SignalState } from "./live-test";

const at = (d: string) => new Date(`${d}T05:15:00Z`);
const st = (symbol: string, d: string, signal: SignalState["signal"], strength: SignalState["strength"]): SignalState => ({ symbol, signal, strength, at: at(d) });
const series = (closes: [string, number][]) => closes.map(([date, close]) => ({ date, close }));

const bars = new Map([
  ["A", series([["2026-11-05", 100], ["2026-11-06", 110], ["2026-11-09", 121], ["2026-11-10", 110]])],
  ["B", series([["2026-11-05", 50], ["2026-11-06", 40], ["2026-11-09", 45], ["2026-11-10", 50]])],
]);
const spx = series([["2026-11-05", 1000], ["2026-11-06", 1010], ["2026-11-09", 1020], ["2026-11-10", 1030]]);

describe("live test replay", () => {
  it("baseline BUY enters at that day's close; no signal exits; open position marked to the last close", () => {
    const r = replayStrategy([st("A", "2026-11-05", "BUY", "weak"), st("A", "2026-11-09", "none", "noise")], bars, spx, "all");
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: "long", entryDate: "2026-11-05", entryPrice: 100, exitDate: "2026-11-09", exitPrice: 121, open: false });
    expect(r.trades[0].return).toBeCloseTo(0.21);
    expect(r.stats.totalReturn).toBeCloseTo(0.21);
    expect(r.stats.winners).toBe(1);

    const o = replayStrategy([st("A", "2026-11-06", "BUY", "weak")], bars, spx, "all");
    expect(o.trades[0]).toMatchObject({ open: true, entryPrice: 110, markDate: "2026-11-10", markPrice: 110, weight: 1 });
    expect(o.trades[0].return).toBeCloseTo(0);
  });

  it("a signal before any close enters at the next close", () => {
    const r = replayStrategy([st("A", "2026-11-07", "BUY", "weak")], bars, spx, "all");
    expect(r.trades[0]).toMatchObject({ signalDate: "2026-11-07", entryDate: "2026-11-09", entryPrice: 121 });
  });

  it("BUY -> SELL flips: exit the long and enter the short at the same close", () => {
    const r = replayStrategy([st("B", "2026-11-05", "BUY", "weak"), st("B", "2026-11-06", "SELL", "weak")], bars, spx, "all");
    const [short, long] = r.trades;
    expect(long).toMatchObject({ side: "long", entryPrice: 50, exitDate: "2026-11-06", exitPrice: 40 });
    expect(long.return).toBeCloseTo(-0.2);
    expect(short).toMatchObject({ side: "short", entryDate: "2026-11-06", entryPrice: 40, open: true, markPrice: 50 });
    expect(short.return).toBeCloseTo(-0.25);
    // Equity: -20% then short 40 -> 45 (-12.5%) then 45 -> 50 (-11.1%).
    expect(r.stats.totalReturn).toBeCloseTo(0.8 * 0.875 * (1 - 5 / 45) - 1);
  });

  it("Strong only: skips weak entries, keeps a position when strong turns weak, exits on no signal", () => {
    const states = [st("A", "2026-11-05", "BUY", "weak"), st("A", "2026-11-06", "BUY", "strong"), st("A", "2026-11-09", "BUY", "weak"), st("A", "2026-11-10", "none", "noise")];
    const r = replayStrategy(states, bars, spx, "strong");
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ entryDate: "2026-11-06", exitDate: "2026-11-10", strength: "strong" });
    const all = replayStrategy(states, bars, spx, "all");
    expect(all.trades).toHaveLength(1);
    expect(all.trades[0].entryDate).toBe("2026-11-05");
  });

  it("Strong x2 weighs a strong entry twice a weak one; equal weight otherwise", () => {
    const states = [st("A", "2026-11-05", "BUY", "strong"), st("B", "2026-11-05", "BUY", "weak")];
    const x2 = replayStrategy(states, bars, spx, "strong-x2");
    const eq = replayStrategy(states, bars, spx, "all");
    // Day 1: A +10%, B -20%.
    expect(eq.lines[0].points[1].value).toBeCloseTo((0.1 - 0.2) / 2);
    expect(x2.lines[0].points[1].value).toBeCloseTo((2 * 0.1 - 0.2) / 3);
    expect(x2.trades.find((t) => t.symbol === "A")!.weight).toBeCloseTo(2 / 3);
    expect(eq.trades.find((t) => t.symbol === "A")!.weight).toBeCloseTo(0.5);
  });

  it("a ticker with no signal ever makes no trade; the S&P is rebased at the first signal day", () => {
    const r = replayStrategy([st("A", "2026-11-06", "none", "noise")], bars, spx, "all");
    expect(r.trades).toHaveLength(0);
    expect(r.stats.totalReturn).toBe(0);
    expect(r.stats.winners).toBeNull();
    const bench = r.lines.find((l) => l.kind === "benchmark")!;
    expect(bench.points[0]).toEqual({ date: "2026-11-06", value: 0 });
    expect(r.stats.benchmarkReturn).toBeCloseTo(1030 / 1010 - 1);
  });

  it("best and worst ticker compound each ticker's trades", () => {
    const r = replayStrategy([st("A", "2026-11-05", "BUY", "weak"), st("A", "2026-11-09", "none", "noise"), st("B", "2026-11-05", "BUY", "weak"), st("B", "2026-11-06", "none", "noise")], bars, spx, "all");
    expect(r.stats.best?.symbol).toBe("A");
    expect(r.stats.worst?.symbol).toBe("B");
    expect(r.stats.worst?.return).toBeCloseTo(-0.2);
  });
});
