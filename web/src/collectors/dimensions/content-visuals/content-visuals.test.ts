import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import { fairValues } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentVisuals, pickVisualSubjects, renderSource, VISUALS_VERSION } from ".";
import { gapWords, videoFrames } from "./render";

let db: Db;
let close: () => Promise<void>;
let ideaId: string;

async function addIdea(refs: content.IdeaSourceRef[], withDraft = true) {
  const [idea] = await db
    .insert(content.contentIdeas)
    .values({ generationBronzeId: crypto.randomUUID(), rank: 1, day: "2026-11-06", symbol: "CCLD", title: "CareCloud replaced the client the market thinks it lost.", angle: "a", sourceRefs: refs, model: "fake", sources: ["claude"], bronzeIds: [] })
    .returning();
  if (withDraft) {
    await db.insert(content.contentDrafts).values({
      generationBronzeId: crypto.randomUUID(), symbol: "CCLD", inputKey: `idea:${idea.id}`, ideaId: idea.id, format: "x-post", accountId: null, version: 1, title: null, body: "b",
      inputs: { symbol: "CCLD", companyName: null, news: null, worthJudgmentId: null, worth: null, thesis: null, driver: null, chart: null }, model: "fake", sources: ["claude"], bronzeIds: [],
    });
  }
  return idea.id;
}

const EVIDENCE = { kind: "evidence" as const, ref: "evidence:CCLD|news:n1", symbol: "CCLD", label: "CCLD signs a new hospital client" };

beforeEach(async () => {
  ({ db, close } = await testDb());
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  const days = Array.from({ length: 60 }, (_, i) => new Date(Date.now() - (60 - i) * 86400_000).toISOString().slice(0, 10));
  await db.insert(gold.priceBars).values(days.map((date, i) => ({ symbol: "CCLD", date, close: 3 - i / 60, sources: ["yahoo"], alternatives: [] })));
  await db.insert(fairValues).values({ symbol: "CCLD", value: 3.19, currency: "USD", low: 2.6, high: 3.8, author: "claude", inputs: [] });
  ideaId = await addIdea([EVIDENCE]);
  vi.stubEnv("FFMPEG_PATH", "/nonexistent/ffmpeg");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

const ctx = { env: {}, fetch };
const renderOnly = { ...contentVisuals, sources: [renderSource] };

describe("content-visuals dimension", () => {
  it("asks for the card, video and chart of every drafted Idea, and a capture only when it cites a news item", async () => {
    const noNews = await addIdea([{ kind: "signal", ref: "signal:CCLD", symbol: "CCLD", label: "CareCloud: BUY" }]);
    await addIdea([EVIDENCE], false); // no draft yet: nothing to draw
    const subjects = await pickVisualSubjects(db);
    expect(subjects.sort()).toEqual(
      [`idea:${ideaId}#montage`, `idea:${ideaId}#video`, `idea:${ideaId}#chart`, `idea:${ideaId}#capture`, `idea:${noNews}#montage`, `idea:${noNews}#video`, `idea:${noNews}#chart`].sort(),
    );
  });

  it("stores the PNGs once, a failure with its reason, and serves gold without the files", async () => {
    await runDimension(db, renderOnly, { trigger: "test", ctx });
    const rows = await db.select().from(content.contentVisuals).where(eq(content.contentVisuals.ideaId, ideaId));
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.montage).toMatchObject({ status: "ok", mime: "image/png", width: 1280, height: 720, version: VISUALS_VERSION, caption: "Prices: Yahoo Finance" });
    expect(byKind.montage.file!.subarray(1, 4).toString()).toBe("PNG");
    expect(byKind.chart.status).toBe("ok");
    // No ffmpeg here: the video says why, nothing pretends.
    expect(byKind.video).toMatchObject({ status: "failed", file: null });
    expect(byKind.video.error).toMatch(/ENOENT|ffmpeg/);

    const g = await db.select().from(content.goldContentVisuals).where(eq(content.goldContentVisuals.ideaId, ideaId));
    expect(g.map((v) => v.kind).sort()).toEqual(["chart", "montage", "video"]);
    expect(g.find((v) => v.kind === "montage")!.sizeBytes).toBe(byKind.montage.file!.length);

    // Done ones are not drawn again; the fresh failure waits a day.
    expect((await pickVisualSubjects(db)).filter((s) => !s.endsWith("#capture"))).toEqual([]);
  });

  it("a day-old failure is tried again and replaced when it works", async () => {
    await runDimension(db, renderOnly, { trigger: "test", ctx });
    await db.update(content.contentVisuals).set({ createdAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(content.contentVisuals.kind, "video"));
    expect(await pickVisualSubjects(db)).toContain(`idea:${ideaId}#video`);
  });

  it("a ticker with too few closes gets no chart, and says so", async () => {
    await db.delete(gold.priceBars);
    await runDimension(db, renderOnly, { trigger: "test", ctx });
    const [chart] = await db.select().from(content.contentVisuals).where(eq(content.contentVisuals.kind, "chart"));
    expect(chart).toMatchObject({ status: "failed", error: expect.stringMatching(/only 0 closes/) });
  });
});

describe("visual helpers", () => {
  it("says the gap in words and plays 7 seconds", () => {
    expect(gapWords(2.16, 3.19)).toBe("32% below fair value");
    expect(gapWords(12, 10)).toBe("20% above fair value");
    const frames = videoFrames(30);
    expect(frames).toHaveLength(210);
    expect(frames[0]).toMatchObject({ reveal: 0 });
    expect(frames.at(-1)).toEqual({ progress: 1, reveal: 1 });
  });
});
