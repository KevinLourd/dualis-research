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

describe("Narrative Drivers (A) and Driver Signals (B) in the panel, read from the KPI drivers", () => {
  const kpi = (rank: number, name: string, level: "strong" | "weak" | "none", signal: "strong" | "weak" | "none" | null) =>
    ({ id: `X:kpi:${rank}`, rank, name, level, signal, signalWhy: `${name} moved`, direction: "up", confirmed: 2, rows: [{}, {}, {}] }) as never;
  const kpis = [kpi(1, "Cash returned to holders", "none", null), kpi(2, "Operating margin", "weak", "weak"), kpi(3, "Order intake", "strong", "none")];

  it("A lists the trusted KPIs only, strongest first, each opening its test panel", async () => {
    const { KpiDrivers } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(KpiDrivers, { symbol: "X", kpis }));
    expect(html).not.toContain("Cash returned to holders");
    expect(html.indexOf("Order intake")).toBeLessThan(html.indexOf("Operating margin"));
    expect(html).toContain("Strong confidence");
    expect(html).toContain("Confirmed 2 times");
    expect(html).toContain(encodeURIComponent("kdriver:X:kpi:3"));
  });

  it("B lists, among A, only the KPIs turning now", async () => {
    const { KpiSignals } = await import("@/console/analysis");
    const html = renderToStaticMarkup(createElement(KpiSignals, { symbol: "X", kpis }));
    expect(html).toContain("Operating margin");
    expect(html).not.toContain("Order intake");
    expect(html).toContain("Weak turn · up");
  });

  it("says Not tested yet before a run, and a dash when no KPI is trusted", async () => {
    const { KpiDrivers, KpiSignals } = await import("@/console/analysis");
    expect(renderToStaticMarkup(createElement(KpiDrivers, { symbol: "X", kpis: [] }))).toContain("Not tested yet.");
    expect(renderToStaticMarkup(createElement(KpiDrivers, { symbol: "X", kpis: [kpis[0]] }))).toContain("–");
    expect(renderToStaticMarkup(createElement(KpiSignals, { symbol: "X", kpis: [kpis[2]] }))).toContain("No driver is turning now.");
  });
});
