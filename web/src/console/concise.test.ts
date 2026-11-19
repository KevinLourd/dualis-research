import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/console/link", () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => createElement("a", { href, className }, children) }));

/** Concision (Kevin 2026-11-18): the conclusion first, everything else in closed drawers. */

describe("a claim's drawer title is its first sentence, whole", () => {
  it("splits after the first sentence, never inside a decimal or an abbreviation", async () => {
    const { leadSentence } = await import("@/console/item-detail");
    expect(leadSentence("Profit has swung hard while sales stood still. Operating income fell from 53.80B in 2021 to 15.97B in 2023.")).toEqual({
      lead: "Profit has swung hard while sales stood still.",
      rest: "Operating income fell from 53.80B in 2021 to 15.97B in 2023.",
    });
    expect(leadSentence("Revenue rose only 1.0% in 2024 and 3.8% in 2025.")).toEqual({ lead: "Revenue rose only 1.0% in 2024 and 3.8% in 2025.", rest: "" });
    const us = "Demand in the whole of the U.S. Midwest fell again. Volumes dropped 12%.";
    expect(leadSentence(us)).toEqual({ lead: us, rest: "" });
  });
});

describe("Narrative Drivers (A) and Driver Signals (B) in the panel", () => {
  const driver = (rank: number, title: string, level: "strong" | "weak" | "noise" | null, state: { effect: string; strength: string } | null) =>
    ({ id: `X:long:${rank}`, rank, category: "Business economics", title, summary: "A long sentence nobody needs here.", evidence: [], exhibits: [], state: state && { ...state, durability: null }, confidence: level && { level } }) as never;
  const drivers = [driver(1, "Cash pile earns little", "noise", null), driver(2, "Profits peaked and fell", "weak", { effect: "reversal", strength: "weak" }), driver(3, "Value-up plan underway", "strong", { effect: "continuation", strength: "weak" })];

  it("A lists the trusted drivers only, strongest first, each opening its confidence panel", async () => {
    const { Drivers } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(Drivers, { symbol: "X", side: "long", thesis: null, drivers }));
    expect(html).not.toContain("Cash pile earns little");
    expect(html.indexOf("Value-up plan underway")).toBeLessThan(html.indexOf("Profits peaked and fell"));
    expect(html).toContain("Strong confidence");
    expect(html).toContain(encodeURIComponent("confidence:X:long:3"));
    expect(html).not.toContain("A long sentence nobody needs here.");
  });

  it("B lists, among A, only the drivers turning now, each opening its signal panel", async () => {
    const { DriverSignals } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(DriverSignals, { symbol: "X", side: "long", thesis: null, drivers }));
    expect(html).toContain("Profits peaked and fell");
    expect(html).not.toContain("Value-up plan underway");
    expect(html).toContain(encodeURIComponent("driver:X:long:2"));
  });

  it("says so when nothing is trusted or turning", async () => {
    const { Drivers, DriverSignals } = await import("@/console/analysis");
    const none = [driver(1, "Cash pile earns little", "noise", null)];
    expect(renderToStaticMarkup(createElement(Drivers, { symbol: "X", side: "long", thesis: null, drivers: none }))).toContain("No driver the market has shown it trades on.");
    expect(renderToStaticMarkup(createElement(Drivers, { symbol: "X", side: "long", thesis: null, drivers: [driver(1, "x", null, null)] }))).toContain("Not tested yet.");
    expect(renderToStaticMarkup(createElement(DriverSignals, { symbol: "X", side: "long", thesis: null, drivers: none }))).toContain("No driver is turning now.");
  });
});
