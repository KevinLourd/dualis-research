import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetches } from "@/db/schema/bronze";
import { goldCatalysts, thesisAssessments, thesisConfidence, thesisTransitions } from "@/db/schema/catalysts";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { analyseEveryTicker, testDb } from "@/test/db";
import { seedThesis } from "@/test/thesis-fixture";
import { confidenceRequest, thesisConfidenceDimension } from "./dimensions/thesis-confidence";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const ctx: SourceContext = { env: { REPO_ROOT }, fetch: (async () => new Response("{}")) as typeof fetch };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx });
  await analyseEveryTicker(db);
  await seedThesis(db, ["MNRO"]);
});
afterEach(async () => close());

async function catalyst(day: string, direction: "contradicts" | "continues", headline: string) {
  await db.insert(goldCatalysts).values({
    id: `MNRO:${direction}:${day}`,
    symbol: "MNRO",
    kind: "news",
    eventDay: day,
    eventAt: new Date(`${day}T12:00:00Z`),
    direction,
    probability: 0.8,
    reason: `Because ${headline}.`,
    evidence: headline,
    headline,
    url: null,
    publisher: null,
    newsItemIds: [],
    filingIds: [],
    sources: ["google-news", "claude"],
  });
}

/** Fake judge: the state is the word after "STATE=" in the newest evidence line. */
function fakeJudge() {
  return vi.fn<Complete>(async ({ prompt }) => {
    const lines = prompt.split("Text:\n")[1].split("\n").filter(Boolean);
    const verdict = /STATE=(\S+)"/.exec(lines.at(-1) ?? "")?.[1] ?? "holds";
    return { text: JSON.stringify({ verdict, probability: 0.75, cited_sentence: lines.at(-1), reason: `Now ${verdict}.` }), model: "fake" };
  });
}

describe("narrative state", () => {
  it("a ticker with no evidence holds and costs no judgment", async () => {
    const complete = fakeJudge();
    await runDimension(db, thesisConfidenceDimension(complete), { trigger: "test", ctx });
    expect(complete).not.toHaveBeenCalled();
    const rows = await db.select().from(thesisConfidence);
    expect(rows).toHaveLength(37);
    expect(rows.every((r) => r.state === "holds" && r.evidenceCount === 0)).toBe(true);
    expect(await db.select().from(thesisTransitions)).toHaveLength(0);
  });

  it("judges once per evidence set; the first assessment is the baseline, each later change is a signal", async () => {
    const complete = fakeJudge();
    const dim = thesisConfidenceDimension(complete);
    // First look: the narrative is already cracking. Baseline: the state, no signal (no burst on a new question).
    await catalyst("2026-11-02", "contradicts", "Big contract STATE=cracking");
    await runDimension(db, dim, { trigger: "test", ctx });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].prompt).toContain("The market's narrative (what the price reflects): Investors see MNRO as a shrinking business.");
    expect(await db.select().from(thesisTransitions)).toHaveLength(0);
    const [first] = await db.select().from(thesisConfidence).where(eq(thesisConfidence.symbol, "MNRO"));
    expect(first).toMatchObject({ state: "cracking", since: null });

    // Same evidence: nothing asked, nothing new in bronze.
    await runDimension(db, dim, { trigger: "test", ctx });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await db.select().from(fetches).where(eq(fetches.dimension, "thesis-confidence"))).toHaveLength(1);

    // New evidence, the story holds again: a signal. Then cracks again: another.
    await catalyst("2026-11-03", "continues", "Sales fall again STATE=holds");
    await runDimension(db, dim, { trigger: "test", ctx });
    await catalyst("2026-11-04", "contradicts", "Second contract STATE=cracking");
    await runDimension(db, dim, { trigger: "test", ctx });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(await db.select().from(judgments).where(eq(judgments.subjectKind, "thesis-confidence"))).toHaveLength(3);
    expect(await db.select().from(thesisAssessments)).toHaveLength(3);

    const transitions = (await db.select().from(thesisTransitions)).sort((a, b) => a.at.getTime() - b.at.getTime());
    expect(transitions.map((t) => `${t.fromState}>${t.toState}`)).toEqual(["cracking>holds", "holds>cracking"]);
    expect(transitions[1]).toMatchObject({ symbol: "MNRO", reason: "Now cracking." });
    expect(transitions[1].citedEvidence).toContain("Second contract");
    expect(transitions[1].evidenceIds).toHaveLength(3);

    const [mnro] = await db.select().from(thesisConfidence).where(eq(thesisConfidence.symbol, "MNRO"));
    expect(mnro.since?.getTime()).toBe(transitions[1].at.getTime());
  });

  it("evidence dated before the narrative was written is marked known, later evidence new", () => {
    const { question, input } = confidenceRequest("X", { narrative: "n", summary: "s", position: "long", writtenOn: "2026-11-04" }, [
      { id: "a", at: "2026-06-30", line: "old reading" },
      { id: "b", at: "2026-11-04", line: "today news" },
    ]);
    expect(input.split("\n")).toEqual(["[known] old reading", "[new] today news"]);
    expect(question).toContain("Written on 2026-11-04");
  });
});
