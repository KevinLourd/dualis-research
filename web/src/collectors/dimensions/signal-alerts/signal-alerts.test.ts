import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exhibits, narrativeStates, signalChanges } from "@/db/schema/analysis";
import * as content from "@/db/schema/content";
import { priceBars } from "@/db/schema/gold";
import { fairValues } from "@/db/schema/analysis";
import { whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { alertInput } from "./data";
import { alertPng, alertSvg, comparison } from "./render";
import { signalAlertsDim } from ".";

const THIERRY = "15550000001";
const KEVIN = "15550000002";

let db: Db;
let close: () => Promise<void>;
const run = () => runDimension(db, signalAlertsDim, { trigger: "test", ctx: { env: {}, fetch } });
const change = (symbol: string, from: [string, string], to: [string, string], hoursAgo = 0) => ({
  id: crypto.randomUUID(), symbol, fromSignal: from[0] as "none", fromStrength: from[1] as "noise", toSignal: to[0] as "BUY", toStrength: to[1] as "weak",
  at: new Date(Date.now() - hoursAgo * 3600_000), updateNote: `${symbol} note.`, evidenceIds: [],
});

beforeEach(async () => {
  ({ db, close } = await testDb());
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  await db.delete(signalChanges);
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (30 - i) * 86400_000).toISOString().slice(0, 10));
  await db.insert(priceBars).values(days.map((date, i) => ({ symbol: "CCLD", date, close: 3 + i / 30, sources: ["yahoo"], observations: [], alternatives: [] })) as never);
  await db.insert(fairValues).values({ symbol: "CCLD", value: 6, currency: "USD", low: 4.5, high: 8, author: "claude", inputs: [] });
  await db.insert(narrativeStates).values({ id: "CCLD:long:1", symbol: "CCLD", side: "long", level: "driver", driverId: "CCLD:long:1", effect: "reversal", strength: "strong", why: "w", probability: 0.9, evidenceIds: [], headline: "New client signed", since: "2026-11-05", pricedIn: "partly", judgmentId: crypto.randomUUID(), asOf: new Date() });
  await db.insert(whatsappLink).values({ id: "default", status: "linked" });
});
afterEach(async () => close());

describe("signal-alerts", () => {
  it("sends a new strong signal to Kevin and Thierry with its picture, once; a weak one, a downgrade, a stale one and an old text alert send nothing", async () => {
    const up = change("CCLD", ["none", "noise"], ["BUY", "strong"]);
    const weak = change("CCLD", ["none", "noise"], ["SELL", "weak"]);
    const down = change("CCLD", ["BUY", "strong"], ["BUY", "weak"]);
    const gone = change("CCLD", ["BUY", "weak"], ["none", "noise"]);
    const stale = change("CCLD", ["none", "noise"], ["BUY", "strong"], 30);
    const oldText = change("CCLD", ["SELL", "weak"], ["SELL", "strong"]);
    await db.insert(signalChanges).values([up, weak, down, gone, stale, oldText]);
    // The old text-only alert already went to Thierry for this one (content-dispatch, before the switch).
    await db.insert(content.contentMessages).values({ outboxId: crypto.randomUUID(), bronzeId: crypto.randomUUID(), purpose: "alert", transitionId: oldText.id, recipient: THIERRY, scheduledAt: new Date(), sources: ["content"] });
    await run();
    await run();
    const out = await db.select().from(whatsappOutbox);
    expect(out.map((o) => o.recipient).sort()).toEqual([THIERRY, KEVIN].sort());
    for (const o of out) {
      expect(o.requestedBy).toBe("signal-alerts");
      expect(o.imageMime).toBe("image/png");
      expect(o.image?.length).toBeGreaterThan(10_000);
      expect(o.text).toContain("*CCLD* (CareCloud): BUY (strong inflection), was no signal.");
      expect(o.text).toContain("CCLD note.");
    }
    const msgs = await db.select().from(content.contentMessages);
    expect(msgs.filter((m) => m.transitionId === up.id).map((m) => m.purpose)).toEqual(["alert", "alert"]);
  });

  it("a strong signal that flickers off and back on is one alert; a side flip still alerts", async () => {
    const first = change("CCLD", ["none", "noise"], ["SELL", "strong"], 3);
    await db.insert(signalChanges).values(first);
    await run();
    await db.insert(signalChanges).values([change("CCLD", ["SELL", "strong"], ["none", "noise"], 2), change("CCLD", ["none", "noise"], ["SELL", "strong"], 1)]);
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(2);
    await db.insert(signalChanges).values(change("CCLD", ["SELL", "strong"], ["BUY", "strong"]));
    await run();
    const out = await db.select().from(whatsappOutbox);
    expect(out).toHaveLength(4);
    expect(out.filter((o) => o.text?.includes("BUY (strong inflection), was SELL (strong crack)"))).toHaveLength(2);
  });

  it("the same strong signal is sent once in 30 days: blocked 10 days later, sent again after 31", async () => {
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["SELL", "strong"]));
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(2);
    await db.update(content.contentMessages).set({ createdAt: new Date(Date.now() - 10 * 86400_000) });
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["SELL", "strong"]));
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(2);
    await db.update(content.contentMessages).set({ createdAt: new Date(Date.now() - 31 * 86400_000) });
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["SELL", "strong"]));
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(4);
  });

  it("queues nothing while the WhatsApp device is not linked", async () => {
    await db.update(whatsappLink).set({ status: "waiting-for-scan" });
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["BUY", "strong"]));
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(0);
  });

  it("the picture and caption show the signal, the story, the reported figure that breaks it and each driver's Status; never a fair value (Thierry 2026-11-16)", async () => {
    await db.update(narrativeStates).set({ headline: "Q3 revenue $46.0M, up from $40.0M a year earlier" });
    const quarters = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
    await db.insert(exhibits).values({ id: "CCLD:long:1:1", symbol: "CCLD", driverId: "CCLD:long:1", rank: 1, number: 1, title: "Revenue per quarter", chart: "bar", series: [{ key: "q:revenue", label: "Revenue", unit: "currency", currency: "USD", sources: ["sec"] }], points: quarters.map((period, i) => ({ period, values: { "q:revenue": [40, 41, 43, 44, 46][i] * 1e6 } })), takeaway: "t", sources: ["sec"] });
    const judge = async () => ({ text: JSON.stringify({ verdict: "2025-09-30", probability: 0.9, cited_sentence: null, reason: "a year earlier" }), model: "fake" });
    const input = await alertInput(db, change("CCLD", ["SELL", "weak"], ["BUY", "strong"]), judge);
    expect(input.side).toBe("long");
    expect(input.narrative).toBe("The market thinks CCLD lost its biggest client.");
    expect(input.drivers).toEqual([{ category: "Business economics", title: "Client loss", summary: "Revenue fell 20%.", state: { effect: "reversal", strength: "strong", headline: "Q3 revenue $46.0M, up from $40.0M a year earlier", since: "2026-11-05", pricedIn: "partly" } }]);
    expect(input.breaks.map((b) => [b.driver, b.headline, b.base])).toEqual([["Client loss", "Q3 revenue $46.0M, up from $40.0M a year earlier", "2025-09-30"]]);
    const cmp = comparison(input.breaks[0])!;
    expect(cmp.periods).toEqual(["2025-09-30", "2026-09-30"]);
    expect(cmp.text).toMatch(/→ .* \(\+15%\)$/);
    expect(JSON.stringify(input)).not.toMatch(/fair|quote/i);
    const svg = alertSvg(input);
    for (const t of ["CareCloud", "BUY", "Strong inflection", "was SELL (weak crack)", "THE MARKET BELIEVES", "lost its biggest client", "THE REPORTED FIGURE", "Q3 revenue $46.0M, up from $40.0M a year earlier", "Revenue per quarter", "(+15%)", "NARRATIVE DRIVERS", "Client loss", "Since 5 Nov 2026", "Partly in the price", "Not investment advice"]) {
      expect(svg).toContain(t);
    }
    expect(svg).not.toMatch(/fair value|Range |below fair|above fair|SELL zone|BUY zone|opportunity/i);
    if (process.env.RENDER_DIR) (await import("node:fs")).writeFileSync(`${process.env.RENDER_DIR}/signal-alert.png`, alertPng(input));
  });

  it("the caption carries the signal, the reported figure and the Update Note, never a gap", async () => {
    await db.update(narrativeStates).set({ headline: "Q3 revenue $46.0M, up from $40.0M a year earlier" });
    await db.insert(exhibits).values({ id: "CCLD:long:1:1", symbol: "CCLD", driverId: "CCLD:long:1", rank: 1, number: 1, title: "Revenue per quarter", chart: "bar", series: [{ key: "q:revenue", label: "Revenue", unit: "currency", currency: "USD", sources: ["sec"] }], points: [{ period: "2026-09-30", values: { "q:revenue": 46e6 } }], takeaway: "t", sources: ["sec"] });
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["BUY", "strong"]));
    await run();
    const [o] = await db.select().from(whatsappOutbox);
    expect(o.text).toBe(`*CCLD* (CareCloud): BUY (strong inflection), was no signal.\nReported figure: Q3 revenue $46.0M, up from $40.0M a year earlier\nCCLD note.\nWhy: ${o.text!.split("Why: ")[1]}`);
    expect(o.text).not.toMatch(/fair value|%/);
  });
});
