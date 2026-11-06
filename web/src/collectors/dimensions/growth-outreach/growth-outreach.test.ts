import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateFiles } from "@/db/schema/app";
import * as growth from "@/db/schema/growth";
import { runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";
import { progress, planned } from "@/growth/goal";
import { recordOutreachEdit } from "@/growth/manual";
import { fixturePrivateFiles, testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { growthOutreach } from ".";
import { parseOutreachMarkdown } from "./parse";

const privateFile = (path: string) => fixturePrivateFiles()[path];

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

describe("outreach file", () => {
  it("parses each draft with handle, publication, ask and message", () => {
    const drafts = parseOutreachMarkdown(privateFile("data/outreach/fixture-a.md"));
    expect(drafts.map((d) => d.handle)).toEqual(["annexample", "quickvalue"]);
    const first = drafts[0];
    expect(first.publicationName).toBe("Example Stocks");
    expect(drafts[1].publicationName).toBe("Quick Value Example");
    expect(first.ask).toBe("guest post on an example name");
    expect(first.body.startsWith("Hi Ann,\n\nI'm Thierry")).toBe(true);
    expect(first.body.endsWith("analysisparalysis888.substack.com")).toBe(true);
  });

  it("fails loud on a section without a handle", () => {
    expect(() => parseOutreachMarkdown("## 1. Someone — 4K\n> Hi")).toThrow(/no \(@handle\)/);
  });
});

describe("growth-outreach dimension", () => {
  it("lands the private files in bronze, Thierry's edit and status win in gold and survive a re-collect", async () => {
    const ctx = { env: {}, fetch };
    expect((await runDimension(db, growthOutreach, { trigger: "test", ctx })).status).toBe("succeeded");
    let gold = await db.select().from(growth.goldGrowthOutreach);
    // One row per author across every outreach file in data/outreach (new batches add files).
    expect(gold.map((g) => g.handle).sort()).toEqual(["annexample", "quickvalue", "roadwriter"]);
    expect(gold.every((g) => g.status === "draft" && g.bodySource === "claude-draft")).toBe(true);

    await recordOutreachEdit(db, "quickvalue", { body: "Hi, my own words.", userId: "user_1" });
    await recordOutreachEdit(db, "quickvalue", { status: "sent", userId: "user_1" });
    await runDimension(db, growthOutreach, { trigger: "test", ctx });

    gold = await db.select().from(growth.goldGrowthOutreach);
    const quick = gold.find((g) => g.handle === "quickvalue")!;
    expect(quick.body).toBe("Hi, my own words.");
    expect(quick.bodySource).toBe("console");
    expect(quick.claudeBody).toContain("Quick Value");
    expect(quick.status).toBe("sent");
    expect(quick.sources).toEqual(["claude-draft", "console", "targets-doc"]);
    expect(quick.contacts).toEqual([{ label: "Substack DM", href: "https://substack.com/@quickvalue" }]);
    const ann = gold.find((g) => g.handle === "annexample")!;
    expect(ann.contacts).toEqual([
      { label: "Substack DM", href: "https://substack.com/@annexample" },
      { label: "ann@example.com", href: "mailto:ann@example.com" },
    ]);
    expect(ann.sources).toEqual(["claude-draft", "targets-doc"]);
    const road = gold.find((g) => g.handle === "roadwriter")!;
    expect(road.contacts.map((c) => c.label)).toEqual(["Substack DM", "X @roadwriterx"]);
    // Kevin's dashboard reading is the 2026-11-04 count.
    expect(await db.select().from(growth.goldGrowthAudience)).toEqual([expect.objectContaining({ date: "2026-11-04", subscribers: 153, sources: ["dashboard-reading"] })]);
    expect((await db.select().from(runs)).filter((r) => r.trigger === "console").every((r) => r.status === "succeeded")).toBe(true);
  });

  it("fails loud when a private file was never pushed", async () => {
    await db.delete(privateFiles).where(eq(privateFiles.path, "docs/acquisition-targets.md"));
    const report = await runDimension(db, growthOutreach, { trigger: "test", ctx: { env: {}, fetch } });
    expect(JSON.stringify(report)).toContain("docs/acquisition-targets.md is not in app.private_files");
  });

  it("refuses an unknown status", async () => {
    await expect(recordOutreachEdit(db, "quickvalue", { status: "ghosted" as never, userId: null })).rejects.toThrow(/unknown outreach status/);
  });
});

describe("goal", () => {
  it("draws the straight line 153 -> 1,153 and the pace still needed", () => {
    expect(planned("2026-11-04")).toBe(153);
    expect(planned("2026-11-30")).toBe(1153);
    expect(planned("2026-12-15")).toBe(1153);
    const p = progress({ date: "2026-11-04", subscribers: 153 }, "2026-11-04");
    expect(p).toMatchObject({ current: 153, remaining: 1000, daysLeft: 27, perDayNeeded: 38, vsPlan: 0 });
  });
});
