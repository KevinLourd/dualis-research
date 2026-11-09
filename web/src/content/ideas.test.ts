import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { rebuildGoldIdeas } from "./ideas";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
});
afterEach(async () => close());

describe("rebuildGoldIdeas", () => {
  it("Best for = the best offered format: an old article score never wins", async () => {
    const [idea] = await db
      .insert(content.contentIdeas)
      .values({ generationBronzeId: crypto.randomUUID(), rank: 1, day: new Date().toISOString().slice(0, 10), symbol: "CCLD", title: "t", angle: "a", sourceRefs: [], model: "fake", sources: ["claude"], bronzeIds: [] })
      .returning();
    const score = (format: "substack-article" | "x-post" | "substack-note", s: number) =>
      ({ ideaId: idea.id, format, score: s, why: "w", model: "fake", sources: ["claude"], bronzeIds: [] });
    await db.insert(content.contentIdeaScores).values([score("substack-article", 88), score("x-post", 78), score("substack-note", 55)]);
    await rebuildGoldIdeas(db);
    const [gold] = await db.select().from(content.goldContentIdeas);
    expect(gold.bestFormat).toBe("x-post");
    expect(gold.bestScore).toBe(78);
    expect(gold.scores.map((s) => s.format)).toEqual(["x-post", "substack-note"]);
  });
});
