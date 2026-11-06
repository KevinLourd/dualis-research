import { promoteFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import { rebuildGoldTheses, THESIS_DIMENSION } from "@/collectors/dimensions/thesis/gold";
import type { Db } from "@/db/types";

const BRONZE = "00000000-0000-4000-8000-00000000f1f1";

/** A drafted thesis for tests that need one: the market's narrative, the view and the draft date, per symbol. */
export async function seedThesis(db: Db, symbols: string[], draftAsOf = "2026-11-01"): Promise<void> {
  const a = (field: string, value: unknown): Assertion => ({ source: "claude", field, value, bronzeId: BRONZE });
  await promoteFacts(
    db,
    THESIS_DIMENSION,
    new Map(symbols.map((s) => [s, [a("narrative", `Investors see ${s} as a shrinking business.`), a("summary", `New contracts show ${s} is growing again.`), a("draftAsOf", draftAsOf)]])),
  );
  await rebuildGoldTheses(db);
}
