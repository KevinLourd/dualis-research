import { readFacts } from "@/bsg/facts";
import { goldGrowthAudience } from "@/db/schema/growth";
import type { Db } from "@/db/types";
import { OWN } from "@/collectors/dimensions/substack-network/seeds";

/** Where Thierry's daily counts live in silver.facts (subject `pub:<own id>`, field `subscribers@<date>`). */
const READINGS = { dimension: "growth-outreach", source: "dashboard-reading" } as const;
const PUBLIC = { dimension: "substack-network", source: "substack-profile" } as const;

/**
 * gold.growth_audience: one count per day. Kevin's dashboard reading wins over the public profile count, which lags
 * the dashboard by a few subscribers; days without a reading show the public count.
 */
export async function rebuildGoldAudience(db: Db): Promise<void> {
  const subject = `pub:${OWN.publicationId}`;
  const byDate = new Map<string, { subscribers: number; sources: string[] }>();
  for (const { dimension } of [PUBLIC, READINGS]) {
    const fields = (await readFacts(db, dimension, [subject])).get(subject) ?? new Map();
    for (const [field, states] of fields) {
      if (!field.startsWith("subscribers@") || !states[0]) continue;
      // Later dimension (the reading) overwrites the public count of the same day.
      byDate.set(field.slice("subscribers@".length), { subscribers: Number(states[0].value), sources: states[0].sources });
    }
  }
  const now = new Date();
  await db.delete(goldGrowthAudience);
  if (byDate.size) await db.insert(goldGrowthAudience).values([...byDate].map(([date, v]) => ({ date, ...v, rebuiltAt: now })));
}
