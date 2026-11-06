import { and, eq, inArray } from "drizzle-orm";
import { facts, type SilverFact } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { applyAssertions, type Assertion, type FactState } from "./provenance";

/**
 * Writes the new silver.facts state of each subject after applying its assertions.
 * Returns the number of fact rows now held for those subjects.
 */
export async function promoteFacts(
  db: Db,
  dimension: string,
  assertionsBySubject: Map<string, Assertion[]>,
): Promise<number> {
  let rows = 0;
  for (const [subject, assertions] of assertionsBySubject) {
    await db.transaction(async (tx) => {
      const where = and(eq(facts.dimension, dimension), eq(facts.subject, subject));
      const existing = await tx.select().from(facts).where(where);
      const next = applyAssertions(existing.map(toState), assertions);
      const touched = new Set(assertions.map((a) => a.field));
      const byKey = new Map(existing.map((f) => [`${f.field}\u0000${f.valueKey}`, f]));
      const now = new Date();

      await tx.delete(facts).where(where);
      if (next.length > 0) {
        await tx.insert(facts).values(
          next.map((f) => {
            const prior = byKey.get(`${f.field}\u0000${f.valueKey}`);
            return {
              dimension,
              subject,
              field: f.field,
              value: f.value,
              valueKey: f.valueKey,
              sources: f.sources,
              bronzeIds: f.bronzeIds,
              firstSeenAt: prior?.firstSeenAt ?? now,
              lastSeenAt: touched.has(f.field) || !prior ? now : prior.lastSeenAt,
            };
          }),
        );
      }
      rows += next.length;
    });
  }
  return rows;
}

/** Every fact of a dimension for the given subjects, grouped by subject then field. */
export async function readFacts(
  db: Db,
  dimension: string,
  subjects: string[],
): Promise<Map<string, Map<string, FactState[]>>> {
  const out = new Map<string, Map<string, FactState[]>>();
  if (subjects.length === 0) return out;
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.dimension, dimension), inArray(facts.subject, subjects)));
  for (const row of rows) {
    const bySubject = out.get(row.subject) ?? new Map<string, FactState[]>();
    const list = bySubject.get(row.field) ?? [];
    list.push(toState(row));
    bySubject.set(row.field, list);
    out.set(row.subject, bySubject);
  }
  return out;
}

function toState(f: SilverFact): FactState {
  return { field: f.field, value: f.value, valueKey: f.valueKey, sources: f.sources, bronzeIds: f.bronzeIds };
}
