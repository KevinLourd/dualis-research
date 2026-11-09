import { and, eq, inArray } from "drizzle-orm";
import { narratives } from "@/db/schema/analysis";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";

/** Shared by the `narrative-since` dimension (writes the month) and `evidence` (reads it): no import of either. */

export const SINCE_SUBJECT_KIND = "narrative-since";
/** Bump when the question changes meaning: every ticker is asked again. */
export const SINCE_QUESTION = "narrative-since@v2";
/** The oldest month a story can start: news older than this is always "Too old". */
export const SINCE_CAP_MONTHS = 6;

export const sinceKey = (narrativeVersion: string) => `${SINCE_QUESTION}:${narrativeVersion}`;

/** The months a story can start in, oldest (the cap) first: "YYYY-MM". */
export function sinceChoices(now = new Date()): string[] {
  const out: string[] = [];
  for (let back = SINCE_CAP_MONTHS; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** First instant of a "YYYY-MM" month, UTC. */
export const monthStart = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** The cap: first day of the month `SINCE_CAP_MONTHS` ago. Used when a ticker has no judgment yet. */
export const sinceCap = (now = new Date()) => monthStart(sinceChoices(now)[0]);

/** The stored month per thesis (`<symbol>:<side>`) for its current narrative version; theses without one are absent. */
export async function narrativeSinceOf(db: Db, symbols: string[]): Promise<Map<string, { since: Date; judgmentId: string }>> {
  if (symbols.length === 0) return new Map();
  const versions = await db.select({ id: narratives.id, version: narratives.version }).from(narratives).where(inArray(narratives.symbol, symbols));
  const keys = versions.map((v) => sinceKey(v.version));
  if (keys.length === 0) return new Map();
  const j = silver.judgments;
  const rows = await db
    .select({ id: j.id, subjectId: j.subjectId, questionKey: j.questionKey, verdict: j.verdict })
    .from(j)
    .where(and(eq(j.subjectKind, SINCE_SUBJECT_KIND), inArray(j.questionKey, keys)));
  const want = new Map(versions.map((v) => [v.id, sinceKey(v.version)]));
  const out = new Map<string, { since: Date; judgmentId: string }>();
  for (const r of rows) if (want.get(r.subjectId) === r.questionKey) out.set(r.subjectId, { since: monthStart(r.verdict), judgmentId: r.id });
  return out;
}
