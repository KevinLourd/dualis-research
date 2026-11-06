import { and, eq } from "drizzle-orm";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "./complete";

export type JudgeRequest = {
  /** What is judged: "news-item", "filing"... + its id. */
  subjectKind: string;
  subjectId: string;
  /** Stable id of the question, e.g. "hits-driver:<driverId>". Same key = same judgment, never asked twice. */
  questionKey: string;
  question: string;
  /** The text the verdict must rest on; the cited sentence comes from it. */
  input: string;
  choices: readonly string[];
};

export type Judgment = typeof judgments.$inferSelect;

const SYSTEM = [
  "You judge one question about one text for an equity research analyst.",
  "Answer with JSON only, no prose, no code fence:",
  '{"verdict": <one of the allowed choices>, "probability": <0..1, your confidence in the verdict>,',
  '"cited_sentence": <the single sentence of the text that best supports the verdict, copied verbatim, or null>,',
  '"reason": <one short plain-English sentence explaining the verdict to a reader who has not seen the text, no em dash>}',
].join(" ");

/**
 * A judgment is made ONCE and stored in silver.judgments (verdict + probability + cited sentence).
 * A second call with the same (subjectKind, subjectId, questionKey) returns the stored row without calling the LLM.
 */
export async function judge(db: Db, req: JudgeRequest, complete: Complete): Promise<Judgment> {
  const key = and(
    eq(judgments.subjectKind, req.subjectKind),
    eq(judgments.subjectId, req.subjectId),
    eq(judgments.questionKey, req.questionKey),
  );
  const [stored] = await db.select().from(judgments).where(key);
  if (stored) return stored;

  const prompt = `Question: ${req.question}\nAllowed choices: ${req.choices.join(", ")}\n\nText:\n${req.input}`;
  const { text, model } = await complete({ system: SYSTEM, prompt });
  const parsed = parseJudgment(text, req.choices);

  await db
    .insert(judgments)
    .values({
      subjectKind: req.subjectKind,
      subjectId: req.subjectId,
      questionKey: req.questionKey,
      question: req.question,
      verdict: parsed.verdict,
      probability: parsed.probability,
      citedSentence: parsed.citedSentence,
      reason: parsed.reason,
      model,
      raw: { text },
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(judgments).where(key);
  return row;
}

export function parseJudgment(
  text: string,
  choices: readonly string[],
): { verdict: string; probability: number; citedSentence: string | null; reason: string | null } {
  const obj = JSON.parse(firstJsonObject(text)) as { verdict?: unknown; probability?: unknown; cited_sentence?: unknown; reason?: unknown };
  if (typeof obj.verdict !== "string" || !choices.includes(obj.verdict)) {
    throw new Error(`judgment verdict "${String(obj.verdict)}" is not one of ${choices.join(", ")}`);
  }
  const probability = Number(obj.probability);
  if (!(probability >= 0 && probability <= 1)) throw new Error(`judgment probability "${String(obj.probability)}" is not in 0..1`);
  return {
    verdict: obj.verdict,
    probability,
    citedSentence: typeof obj.cited_sentence === "string" ? obj.cited_sentence : null,
    reason: typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().replace(/\s*[—–]\s*/g, ", ") : null,
  };
}

/** The first complete `{...}` in a model answer (it may add a note or a second object after it). */
export function firstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`judgment answer holds no JSON object: ${text.slice(0, 200)}`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`judgment answer has an unterminated JSON object: ${text.slice(0, 200)}`);
}
