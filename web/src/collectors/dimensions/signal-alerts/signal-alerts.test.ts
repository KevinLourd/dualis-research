import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { narrativeStates, signalChanges } from "@/db/schema/analysis";
import * as content from "@/db/schema/content";
import { priceBars } from "@/db/schema/gold";
import { fairValues } from "@/db/schema/analysis";
import { whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { alertInput } from "./data";
import { alertSvg } from "./render";
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
  it("sends an upgrade to Kevin and Thierry with its picture, once; a downgrade, a stale one and an old text alert send nothing", async () => {
    const up = change("CCLD", ["none", "noise"], ["BUY", "weak"]);
    const down = change("CCLD", ["BUY", "strong"], ["BUY", "weak"]);
    const gone = change("CCLD", ["BUY", "weak"], ["none", "noise"]);
    const stale = change("CCLD", ["none", "noise"], ["BUY", "strong"], 30);
    const oldText = change("CCLD", ["BUY", "weak"], ["BUY", "strong"]);
    await db.insert(signalChanges).values([up, down, gone, stale, oldText]);
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
      expect(o.text).toContain("*CCLD* (CareCloud): BUY (weak inflection), was no signal.");
      expect(o.text).toContain("CCLD note.");
    }
    const msgs = await db.select().from(content.contentMessages);
    expect(msgs.filter((m) => m.transitionId === up.id).map((m) => m.purpose)).toEqual(["alert", "alert"]);
  });

  it("queues nothing while the WhatsApp device is not linked", async () => {
    await db.update(whatsappLink).set({ status: "waiting-for-scan" });
    await db.insert(signalChanges).values(change("CCLD", ["none", "noise"], ["BUY", "strong"]));
    await run();
    expect(await db.select().from(whatsappOutbox)).toHaveLength(0);
  });

  it("the picture shows the signal, fair value, quote, chart and each driver with its Status", async () => {
    const input = await alertInput(db, change("CCLD", ["SELL", "weak"], ["BUY", "strong"]));
    expect(input.side).toBe("long");
    expect(input.drivers).toEqual([{ category: "Business economics", title: "Client loss", summary: "Revenue fell 20%.", state: { effect: "reversal", strength: "strong", headline: "New client signed", since: "2026-11-05", pricedIn: "partly" } }]);
    const svg = alertSvg(input);
    for (const t of ["CareCloud", "BUY", "Strong inflection", "was SELL (weak crack)", "6.00 USD", "Range 4.50 to 8.00", "4.00 USD", "33% below fair value", "CCLD: price vs fair value", "NARRATIVE DRIVERS", "Client loss", "New client signed", "Since 5 Nov 2026", "Partly in the price", "Not investment advice"]) {
      expect(svg).toContain(t);
    }
  });
});
