import { and, eq } from "drizzle-orm";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";

/** The dimension that picks a photo per own article (`cover-photos`); its pick is a silver fact read here. */
export const COVER_DIMENSION = "cover-photos";

/** What the website's report cover shows behind the title: a Commons photo, sized for the site, with its credit. */
export type CoverPhoto = { url: string; credit: string; link: string; title: string; width: number; height: number };

/** The chosen photo per post id (latest pick wins), read by the gold rebuild. */
export async function coverPhotosByPost(db: Db): Promise<Map<string, CoverPhoto>> {
  const rows = await db.select().from(facts).where(and(eq(facts.dimension, COVER_DIMENSION), eq(facts.field, "photo")));
  rows.sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
  return new Map(rows.map((r) => [r.subject, r.value as CoverPhoto]));
}
