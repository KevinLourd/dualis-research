import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { goldGrowthAudience, goldGrowthOutreach, goldGrowthTargets, type GoldGrowthOutreach, type GoldGrowthTarget } from "@/db/schema/growth";
import { runs } from "@/db/schema/ops";

/** Growth section reads: gold only. */

export type GrowthRow = {
  /** `?target=` value: the publication id, or `@handle` for a drafted author the crawl has not reached yet. */
  key: string;
  target: GoldGrowthTarget | null;
  outreach: GoldGrowthOutreach | null;
};

export async function listAudience() {
  return getDb().select().from(goldGrowthAudience).orderBy(asc(goldGrowthAudience.date));
}

/**
 * Live = every author we drafted a message for (the targets doc), in ranking order; bench = the next ranked
 * publications we have no message for yet, excluded ones (stopped, paused) left out.
 */
export async function listGrowthTargets(benchSize = 20): Promise<{ live: GrowthRow[]; bench: GrowthRow[] }> {
  const db = getDb();
  const [targets, outreach] = await Promise.all([
    db.select().from(goldGrowthTargets).orderBy(asc(goldGrowthTargets.rank)),
    db.select().from(goldGrowthOutreach).orderBy(asc(goldGrowthOutreach.rank)),
  ]);
  const byHandle = new Map(outreach.map((o) => [o.handle, o]));
  const matched = new Set<string>();
  const live: GrowthRow[] = [];
  const bench: GrowthRow[] = [];
  for (const t of targets) {
    const o = t.authorHandle ? byHandle.get(t.authorHandle) : undefined;
    if (o && !matched.has(o.handle)) {
      matched.add(o.handle);
      live.push({ key: t.publicationId, target: t, outreach: o });
    } else if (!o && !t.excludedReason && bench.length < benchSize) bench.push({ key: t.publicationId, target: t, outreach: null });
  }
  for (const o of outreach) if (!matched.has(o.handle)) live.push({ key: `@${o.handle}`, target: null, outreach: o });
  return { live, bench };
}

export async function getGrowthRow(key: string): Promise<GrowthRow | null> {
  const db = getDb();
  if (key.startsWith("@")) {
    const [o] = await db.select().from(goldGrowthOutreach).where(eq(goldGrowthOutreach.handle, key.slice(1)));
    return o ? { key, target: null, outreach: o } : null;
  }
  const [t] = await db.select().from(goldGrowthTargets).where(eq(goldGrowthTargets.publicationId, key));
  if (!t) return null;
  const [o] = t.authorHandle ? await db.select().from(goldGrowthOutreach).where(eq(goldGrowthOutreach.handle, t.authorHandle)) : [];
  return { key, target: t, outreach: o ?? null };
}

export async function lastNetworkRun() {
  const [run] = await getDb().select().from(runs).where(eq(runs.dimension, "substack-network")).orderBy(desc(runs.startedAt)).limit(1);
  return run ?? null;
}
