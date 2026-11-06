import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { judge, parseJudgment } from "./judge";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

const req = {
  subjectKind: "news-item",
  subjectId: "n1",
  questionKey: "hits-driver:d1",
  question: "Does this item move the Icahn driver?",
  input: "Icahn sold his stake in a rival. Weather was fine.",
  choices: ["yes", "no"],
} as const;

describe("judge", () => {
  it("asks once, stores verdict + probability + cited sentence, never asks again", async () => {
    const complete = vi.fn(async () => ({
      text: '{"verdict":"yes","probability":0.82,"cited_sentence":"Icahn sold his stake in a rival."}',
      model: "fake",
    }));
    const first = await judge(db, req, complete);
    const second = await judge(db, req, complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ verdict: "yes", probability: expect.closeTo(0.82, 5), citedSentence: "Icahn sold his stake in a rival." });
    expect(await db.select().from(judgments)).toHaveLength(1);
  });

  it("reads the first JSON object when the model adds text or a second object after it", () => {
    const text = '{"verdict":"yes","probability":0.6,"cited_sentence":"A {brace} in \\"quotes\\"."}\n\n{"note":"extra"}';
    expect(parseJudgment(text, ["yes", "no"])).toEqual({ verdict: "yes", probability: 0.6, citedSentence: 'A {brace} in "quotes".', reason: null });
  });

  it("refuses a verdict outside the choices", () => {
    expect(() => parseJudgment('{"verdict":"maybe","probability":0.5}', ["yes", "no"])).toThrow(/not one of/);
  });
});
