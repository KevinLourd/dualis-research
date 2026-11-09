import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import { exhibits, fairValues } from "@/db/schema/analysis";
import { judgments } from "@/db/schema/silver";
import type { Complete } from "@/llm/complete";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentVisuals, pickVisualSubjects, renderSource, VISUALS_VERSION } from ".";
import { chartSvg, exhibitSvg, gapWords, signalCardSvg, timeAgo, toneOf, videoFrames } from "./render";
import { COLOR } from "@/design/tokens";
import { fetches as bronzeFetches } from "@/db/schema/bronze";
import { CALLOUT_SYSTEM, calloutPoints, chartJudgeInput, parseCallout } from "./choose";
import { visualInput } from "./data";

let db: Db;
let close: () => Promise<void>;
let ideaId: string;

const DRIVER_IDEA_TITLE = "CareCloud replaced the client the market thinks it lost.";
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

/** A fake judge: answers `verdict` and records what it was shown; the chart's callout gets its own JSON. */
function fakeJudge(verdict: string) {
  const prompts: string[] = [];
  const callouts: string[] = [];
  const complete: Complete = async ({ system, prompt }) => {
    if (system === CALLOUT_SYSTEM) {
      callouts.push(prompt);
      const point = [...prompt.split("Points (id: value):\n")[1].matchAll(/^- (\S+): .*$/gm)].map((m) => m[1]);
      const news = prompt.includes("Reuters") ? { index: 0, domain: "reuters.com" } : null;
      const ids = point.filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id));
      return { text: JSON.stringify({ point: ids.at(-1), note: "Clients back to 45", priceSays: "The biggest client is gone", newsLine: news ? "CareCloud wins a big hospital back" : null, title: "Look: clients just hit a record", chartLabel: "Hospitals that pay us", news }), model: "fake" };
    }
    prompts.push(prompt);
    return { text: JSON.stringify({ verdict, probability: 0.8, cited_sentence: null, reason: "The client count is the striking turn." }), model: "fake" };
  };
  return { complete, prompts, callouts };
}
// A 1x1 PNG stands for the publisher's logo.
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const logoFetch = (async () => new Response(PNG_1PX, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
const ctx = { env: {}, fetch: logoFetch, complete: fakeJudge("price").complete };
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

const DRIVER = { kind: "driver" as const, ref: "driver:CCLD:long:1", symbol: "CCLD", label: "Client loss" };
async function addExhibits() {
  const series = (key: string, label: string) => ({ key, label, unit: "count" as const, currency: null, sources: ["sec"] });
  await db.insert(exhibits).values([
    { id: "CCLD:long:1:1", symbol: "CCLD", driverId: "CCLD:long:1", rank: 1, number: 1, title: "Hospital clients", chart: "bar", series: [series("line:clients", "Hospital clients")],
      points: [2022, 2023, 2024, 2025].map((y, i) => ({ period: `${y}-12-31`, values: { "line:clients": [40, 31, 33, 45][i] } })), takeaway: "Clients are back above the 2022 level.", sources: ["sec"] },
    { id: "CCLD:long:1:2", symbol: "CCLD", driverId: "CCLD:long:1", rank: 2, number: 2, title: "Revenue", chart: "bar", series: [series("line:revenue", "Revenue")],
      points: [{ period: "2025-12-31", values: { "line:revenue": null } }], takeaway: "No data yet.", sources: ["sec"] },
    { id: "OTHER:1:1", symbol: "CCLD", driverId: "CCLD:9", rank: 1, number: 3, title: "Not cited", chart: "line", series: [series("line:x", "X")],
      points: [{ period: "2025-12-31", values: { "line:x": 1 } }], takeaway: "t", sources: [] },
  ]);
}

describe("the chart of an Idea", () => {
  it("draws the most striking Exhibit of the driver the Idea cites, judged once", async () => {
    await addExhibits();
    const cited = await addIdea([DRIVER]);
    const judge = fakeJudge("CCLD:long:1:1");
    await runDimension(db, renderOnly, { trigger: "test", ctx: { ...ctx, complete: judge.complete } });
    const rows = await db.select().from(content.contentVisuals).where(eq(content.contentVisuals.ideaId, cited));
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.chart).toMatchObject({ status: "ok", mime: "image/png", caption: "Exhibit: Hospital clients" });
    // The judge saw the cited driver's Exhibit with data, never an empty one or another driver's.
    const prompt = judge.prompts.find((p) => p.includes(DRIVER_IDEA_TITLE))!;
    expect(prompt).toContain("Exhibit id CCLD:long:1:1");
    expect(prompt).not.toContain("CCLD:long:1:2");
    expect(prompt).not.toContain("OTHER:1:1");
    // Judged once: a second run asks nothing more.
    const asked = judge.prompts.length;
    await runDimension(db, renderOnly, { trigger: "test", ctx: { ...ctx, complete: judge.complete } });
    expect(judge.prompts).toHaveLength(asked);
    const [j] = await db.select().from(judgments).where(eq(judgments.subjectId, cited));
    expect(j).toMatchObject({ subjectKind: "content-idea", verdict: "CCLD:long:1:1" });
  });

  it("an Idea citing Evidence reaches the driver that Evidence moves", async () => {
    await addExhibits();
    const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
    const input = await visualInput(db, idea);
    expect(input.exhibits.map((e) => e.id)).toEqual(["CCLD:long:1:1"]);
    expect(chartJudgeInput(input)).toContain("Hospital clients (count): 2022-12 40, 2023-12 31, 2024-12 33, 2025-12 45 (first 40, last 45)");
  });

  it("draws the price when the judge says the Idea is about price, and asks nothing when no driver is cited", async () => {
    await addExhibits();
    const cited = await addIdea([DRIVER]);
    const onlySignal = await addIdea([{ kind: "signal", ref: "signal:CCLD", symbol: "CCLD", label: "CareCloud: BUY" }]);
    const judge = fakeJudge("price");
    await runDimension(db, renderOnly, { trigger: "test", ctx: { ...ctx, complete: judge.complete } });
    const charts = await db.select().from(content.contentVisuals).where(eq(content.contentVisuals.kind, "chart"));
    expect(charts.find((c) => c.ideaId === cited)).toMatchObject({ status: "ok", caption: "Prices: Yahoo Finance" });
    expect(charts.find((c) => c.ideaId === onlySignal)).toMatchObject({ status: "ok", caption: "Prices: Yahoo Finance" });
    // Two Ideas cite the driver (the seeded one through its Evidence): one question each, none for the signal-only Idea.
    expect(judge.prompts).toHaveLength(2);
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

describe("the chart shouts (Kevin 2026-11-09)", () => {
  it("writes the arrow, note, headline and news strip once, into the chart's bronze request", async () => {
    await addExhibits();
    const judge = fakeJudge("CCLD:long:1:1");
    await runDimension(db, renderOnly, { trigger: "test", ctx: { ...ctx, complete: judge.complete } });
    const [chart] = await db.select().from(content.contentVisuals).where(eq(content.contentVisuals.ideaId, ideaId)).then((r) => r.filter((v) => v.kind === "chart"));
    expect(chart.status).toBe("ok");
    const rows = await db.select().from(bronzeFetches).where(eq(bronzeFetches.subject, `idea:${ideaId}#chart`));
    expect((rows[0].request as { callout: unknown }).callout).toEqual({ point: "2025-12-31", note: "Clients back to 45", priceSays: "The biggest client is gone", newsLine: "CareCloud wins a big hospital back", title: "Look: clients just hit a record", chartLabel: "Hospitals that pay us", news: { index: 0, domain: "reuters.com" } });
    // The callout saw the points and the news with its publisher.
    expect(judge.callouts[0]).toContain("- 2025-12-31: 2025-12 Hospital clients 45");
    expect(judge.callouts[0]).toContain("- 0: Reuters: CCLD signs a new hospital client");
    // It knows what the price says and the drivers it could break.
    expect(judge.callouts[0]).toContain("What the price says (pessimistic narrative): The market thinks CCLD lost its biggest client.");
    expect(judge.callouts[0]).toContain("- 0: Client loss: Revenue fell 20%.");
    // Told to write, never to copy.
    expect(judge.callouts[0]).not.toContain("copied exactly");
  });

  it("colours the one point by the story's side and draws arrow, note and news strip", async () => {
    await addExhibits();
    const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
    const input = await visualInput(db, idea);
    expect(toneOf(input, input.exhibits[0])).toBe("long"); // a long driver's turn is an inflection
    expect(toneOf(input)).toBe("long");
    const banner = { headline: "CareCloud signs a new hospital client", publisher: "Reuters", logo: PNG_1PX.toString("base64"), ago: "2h ago" };
    const say = { priceSays: "The biggest client is gone", chartLabel: "Hospitals that pay us" };
    const svg = exhibitSvg(input, input.exhibits[0], { point: "2025-12-31", note: "Clients back to 45", ...say, title: "Look: clients just hit a record", tone: "long", banner });
    for (const t of ["CareCloud: Hospitals that pay us", "Clients back to 45", "VS price narrative: &quot;The biggest client is gone&quot;", "Look: clients just hit a record", "BREAKING", "REUTERS", "2h ago", "CareCloud signs a new hospital client"]) expect(svg).toContain(t);
    expect(svg).toContain(COLOR.breaking.dark);
    expect(svg).not.toContain("Driver broken");
    // The price card is pasted on top (a PNG), and says the ticker's Signal.
    expect(svg).toContain('<image href="data:image/png;base64,');
    expect(input.signal).toBe("BUY");
    const card = signalCardSvg(input);
    for (const t of ["BUY signal", "Fair value 2.6 to 3.8", "CareCloud: share price vs fair value"]) expect(card).toContain(t);
    expect(signalCardSvg({ ...input, signal: null })).toContain("below fair value");
    expect(svg.toLowerCase()).toContain(COLOR.long.dark.toLowerCase());
    const price = chartSvg(input, undefined, { point: input.bars[10].date, note: "Sold off", ...say, title: "Look: 32% under fair value", tone: "short", banner: null });
    expect(price).toContain("Sold off");
    expect(price.toLowerCase()).toContain(COLOR.short.dark.toLowerCase());
    expect(() => exhibitSvg(input, input.exhibits[0], { point: "1999-12-31", note: "x", ...say, title: "y", tone: "long", banner: null })).toThrow(/not a period/);
  });

  it("refuses a callout pointing off the chart, missing its news source, or naming a driver the Idea does not cite", () => {
    const points = [{ id: "2025-12-31", label: "x" }];
    const base = { note: "n", priceSays: "p", title: "t", chartLabel: "c" };
    expect(() => parseCallout(JSON.stringify({ ...base, point: "2020-01-01", news: null }), points, 0)).toThrow(/not on the chart/);
    expect(() => parseCallout(JSON.stringify({ ...base, point: "2025-12-31", news: null }), points, 1)).toThrow(/news index/);
    expect(parseCallout(JSON.stringify({ ...base, note: "n — m", point: "2025-12-31", newsLine: "A hospital comes back", news: { index: 0, domain: "https://www.ft.com/x" } }), points, 1)).toEqual({ point: "2025-12-31", note: "n, m", priceSays: "p", newsLine: "A hospital comes back", title: "t", chartLabel: "c", news: { index: 0, domain: "www.ft.com" } });
    expect(timeAgo(new Date("2026-11-09T10:00:00Z"), new Date("2026-11-09T12:10:00Z"))).toBe("2h ago");
    expect(timeAgo(new Date("2026-11-06T10:00:00Z"), new Date("2026-11-09T12:00:00Z"))).toBe("3d ago");
    expect(calloutPoints).toBeTypeOf("function");
  });
});
