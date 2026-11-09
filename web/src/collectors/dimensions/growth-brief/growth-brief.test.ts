import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldGrowthAudience, goldGrowthOutreach } from "@/db/schema/growth";
import { whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { briefText, growthBrief } from "@/growth/daily";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { growthBriefDim, planBrief } from ".";
import { briefChartPng } from "./render";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

const audience = [
  { date: "2026-11-04", subscribers: 153 },
  { date: "2026-11-06", subscribers: 160 },
];
const outreach = (handle: string, status: string, statusAt: string | null, recommendsUsSince: string | null = null) => ({
  handle,
  body: "Hi",
  bodySource: "claude-draft",
  status,
  statusAt: statusAt ? new Date(statusAt) : null,
  recommendsUsSince: recommendsUsSince ? new Date(recommendsUsSince) : null,
  contacts: [],
  sources: ["claude-draft"],
});

async function seed() {
  await db.insert(whatsappLink).values({ id: "default", status: "linked" });
  await db.insert(goldGrowthAudience).values(audience.map((a) => ({ ...a, sources: ["substack-profile"] })));
  // Astana day = UTC+5: 2026-11-05T20:00Z is already Nov 6 in Astana.
  await db.insert(goldGrowthOutreach).values([
    outreach("a", "sent", "2026-11-06T04:00:00Z", "2026-11-06T06:00:00Z"),
    outreach("b", "replied", "2026-11-05T20:00:00Z"),
    outreach("c", "sent", "2026-11-05T10:00:00Z"),
    outreach("d", "draft", null),
  ] as never);
}

describe("growth brief figures", () => {
  it("says a lead over the pace, nothing when behind", () => {
    expect(briefText(growthBrief([{ date: "2026-11-04", subscribers: 153 }, { date: "2026-11-05", subscribers: 300 }], [], "2026-11-05"))).toContain("ahead of pace");
  });

  it("matches the Growth page: count, gain, pace, line, yesterday's contacts", () => {
    const b = growthBrief(audience, [], "2026-11-07");
    expect(b).toMatchObject({ current: 160, gained: 7, remaining: 993, daysLeft: 24, perDayNeeded: 42, countedOn: "2026-11-06" });
    expect(b.vsPlan).toBe(160 - 268);
    const text = briefText(b);
    expect(text).toContain("*Analysis Paralysis, Nov 7*");
    expect(text).toContain("160 subscribers (counted Nov 6), +7 since Nov 4");
    expect(text).toContain("Goal 1,153 by Nov 30: 993 to go in 24 days");
    expect(text).toContain("42 new subscribers a day needed");
    expect(text).not.toMatch(/planned|ahead/i);
    expect(text).not.toMatch(/\b(test|line|vsPlan|gold)\b/i);
    expect(text).not.toMatch(/[—–]/);
    // No outreach yesterday: the line is left out, never « 0 writers contacted ».
    expect(text).not.toContain("Yesterday");
  });
});

describe("growth-brief dimension", () => {
  it("queues the brief with the chart for Kevin AND Thierry at 08:00 Astana, once a day each", async () => {
    await seed();
    const ctx = { env: {}, fetch };
    // 01:00 UTC on Nov 7 = 06:00 Nov 7 in Astana: the brief waits for 08:00 Astana (03:00 UTC).
    expect(await planBrief(db, undefined, new Date("2026-11-07T01:00:00Z"))).toEqual(["brief:2026-11-07"]);
    const report = await runDimension(db, { ...growthBriefDim, subjects: (d) => planBrief(d, undefined, new Date("2026-11-07T01:00:00Z")) }, { trigger: "test", ctx });
    expect(report.status).toBe("succeeded");
    const rows = await db.select().from(whatsappOutbox);
    // Kevin (test) and Thierry (client): one row each, same text and chart.
    expect(rows.map((r) => r.recipient).sort()).toEqual(["15550000001", "15550000002"]);
    for (const m of rows) {
      expect(m.requestedBy).toBe("growth-brief");
      expect(m.scheduledAt.toISOString()).toBe("2026-11-07T03:00:00.000Z");
      expect(m.text).toContain("Yesterday: 2 writers contacted, 1 new recommendation");
      expect(m.imageMime).toBe("image/png");
      expect(Buffer.from(m.image!).subarray(1, 4).toString()).toBe("PNG");
    }
    expect(rows[0].text).toBe(rows[1].text);

    // A second run the same Astana day queues nothing.
    expect(await planBrief(db, undefined, new Date("2026-11-07T05:00:00Z"))).toEqual([]);
  });

  it("queues only the recipient still missing today's brief", async () => {
    await seed();
    await db.insert(whatsappOutbox).values({ recipient: "15550000002", text: "x", scheduledAt: new Date("2026-11-07T03:00:00Z"), requestedBy: "growth-brief" } as never);
    const ctx = { env: {}, fetch };
    await runDimension(db, { ...growthBriefDim, subjects: (d) => planBrief(d, undefined, new Date("2026-11-07T01:00:00Z")) }, { trigger: "test", ctx });
    const rows = await db.select().from(whatsappOutbox);
    expect(rows.map((r) => r.recipient).sort()).toEqual(["15550000001", "15550000002"]);
  });

  it("a recipient added after today's brief went out waits for tomorrow", async () => {
    await seed();
    await db.insert(whatsappOutbox).values({ recipient: "15550000002", text: "x", scheduledAt: new Date("2026-11-07T03:00:00Z"), requestedBy: "growth-brief" } as never);
    expect(await planBrief(db, undefined, new Date("2026-11-07T09:00:00Z"))).toEqual([]);
    expect(await planBrief(db, undefined, new Date("2026-11-08T01:00:00Z"))).toEqual(["brief:2026-11-08"]);
  });

  it("queues nothing while the device is unlinked", async () => {
    await db.insert(whatsappLink).values({ id: "default", status: "waiting-for-scan" });
    expect(await planBrief(db, undefined, new Date("2026-11-07T01:00:00Z"))).toEqual([]);
  });
});

describe("brief chart", () => {
  it("renders a PNG", () => {
    const png = briefChartPng(growthBrief(audience, [], "2026-11-07"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(10_000);
  });
});
