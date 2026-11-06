import { sql } from "drizzle-orm";
import { readFacts } from "@/bsg/facts";
import { type FactState, pickWinner } from "@/bsg/provenance";
import * as silver from "@/db/schema/silver";
import { type ItemState, theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import { CLAUDE_SOURCE, THESIS_MANUAL, THESIS_PRIORITY } from "./sources";

export const THESIS_DIMENSION = "thesis";

/** Thierry's fundamental value as stored in silver.facts (field `fairValue`, console source only). */
export type FairValue = { value: number; currency: string | null; basis: string | null };

/** Claude's candidate, Thierry's winning candidate, the active one and how it was reached. */
export function resolveAuthors(candidates: FactState[]): {
  claude: FactState | null;
  thierry: FactState | null;
  active: FactState | null;
  state: ItemState | null;
} {
  const claude = candidates.find((c) => c.sources.includes(CLAUDE_SOURCE)) ?? null;
  const manual = candidates.filter((c) => c.sources.some((s) => (THESIS_MANUAL as readonly string[]).includes(s)));
  const thierry = pickWinner(manual, { priority: THESIS_PRIORITY, manual: THESIS_MANUAL });
  const active = pickWinner(candidates, { priority: THESIS_PRIORITY, manual: THESIS_MANUAL });
  const state: ItemState | null = !active
    ? null
    : thierry && claude
      ? thierry === claude
        ? "accepted"
        : "edited"
      : thierry
        ? "thierry"
        : "draft";
  return { claude, thierry, active, state };
}

/** gold.theses for every active ticker, from silver.facts "thesis" (Thierry's word winning per field). */
export async function rebuildGoldTheses(db: Db): Promise<number> {
  const symbols = (await db.select({ symbol: silver.tickers.symbol }).from(silver.tickers).where(sql`${silver.tickers.active}`)).map((r) => r.symbol);
  const facts = await readFacts(db, THESIS_DIMENSION, symbols);
  const now = new Date();
  const rows = symbols.map((symbol) => {
    const byField = facts.get(symbol) ?? new Map<string, FactState[]>();
    const narrative = resolveAuthors(byField.get("narrative") ?? []);
    const summary = resolveAuthors(byField.get("summary") ?? []);
    const fair = resolveAuthors(byField.get("fairValue") ?? []).active?.value as FairValue | undefined;
    return {
      symbol,
      narrative: (narrative.active?.value as string) ?? null,
      narrativeState: narrative.state,
      summary: (summary.active?.value as string) ?? null,
      summaryState: summary.state,
      fairValue: fair?.value ?? null,
      fairValueBasis: fair?.basis ?? null,
      currency: fair?.currency ?? null,
      draftAsOf: (resolveAuthors(byField.get("draftAsOf") ?? []).active?.value as string) ?? null,
      rebuiltAt: now,
    };
  });
  await db.delete(theses);
  if (rows.length) await db.insert(theses).values(rows);
  return rows.length;
}
