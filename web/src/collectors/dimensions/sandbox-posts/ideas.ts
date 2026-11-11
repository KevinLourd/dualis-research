import { desc, eq } from "drizzle-orm";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";

/** The Sandbox's Ideas, what sandbox-posts writes. Schema imports only. */

export type IdeaPick = { id: string; symbol: string | null; title: string; score: number };

/** The day's top Ideas (the latest day that has some), best score on the two daily formats first. */
export async function topIdeas(db: Db, n = 4): Promise<IdeaPick[]> {
  const [latest] = await db.select({ day: content.goldContentIdeas.day }).from(content.goldContentIdeas).orderBy(desc(content.goldContentIdeas.day)).limit(1);
  if (!latest) return [];
  const ideas = await db.select().from(content.goldContentIdeas).where(eq(content.goldContentIdeas.day, latest.day));
  const best = (i: content.GoldContentIdea) => Math.max(-1, ...i.scores.filter((s) => s.format === "x-post" || s.format === "substack-note").map((s) => s.score));
  return ideas
    .map((i) => ({ i, score: best(i) }))
    .sort((a, b) => b.score - a.score || a.i.rank - b.i.rank)
    .slice(0, n)
    .map(({ i, score }) => ({ id: i.id, symbol: i.symbol, title: i.title, score }));
}
