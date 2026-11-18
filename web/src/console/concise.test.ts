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

describe("Narrative Drivers: only the ones that turn show", () => {
  const driver = (rank: number, title: string, state: { effect: string; strength: string } | null) => ({ id: `X:long:${rank}`, rank, category: "Business economics", title, summary: "A long sentence nobody needs here.", evidence: [], exhibits: [], state: state && { ...state, durability: null } }) as never;
  it("a turning driver sits on screen, the others in one closed drawer, no summary sentence", async () => {
    const { Drivers } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(Drivers, { symbol: "X", side: "long", thesis: null, drivers: [driver(1, "Profits swing", { effect: "continuation", strength: "weak" }), driver(2, "Debt is too high", { effect: "reversal", strength: "weak" }), driver(3, "Nobody covers it", { effect: "noise", strength: "noise" })] }));
    const at = (s: string) => html.indexOf(s);
    expect(at("Debt is too high")).toBeGreaterThan(-1);
    expect(at("Debt is too high")).toBeLessThan(at("2 other drivers, not turning"));
    expect(at("2 other drivers, not turning")).toBeLessThan(at("Profits swing"));
    expect(html).not.toContain("A long sentence nobody needs here.");
    expect(html).not.toContain("Checked");
  });
  it("no driver turning says so", async () => {
    const { Drivers } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(Drivers, { symbol: "X", side: "long", thesis: null, drivers: [driver(1, "Profits swing", { effect: "noise", strength: "noise" })] }));
    expect(html).toContain("No driver is turning.");
    expect(html).toContain("1 driver");
  });
});
