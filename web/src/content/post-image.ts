import { desc, eq } from "drizzle-orm";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";

/** The image a post goes out with on WhatsApp: the Idea's 16:9 post card, else its chart (content-visuals). */
const PREFERRED = ["montage", "chart"] as const;

export type PostImage = { state: "ready"; visualId: string; image: Buffer; mime: string } | { state: "waiting" } | { state: "none" };

/**
 * "waiting" while content-visuals has not drawn the card yet (no row for it), "none" when it failed and no other
 * picture exists, else the newest image bytes from silver (gold keeps no bytes).
 */
export async function postImage(db: Db, ideaId: string | null): Promise<PostImage> {
  if (!ideaId) return { state: "none" };
  const rows = await db
    .select({ id: content.contentVisuals.id, kind: content.contentVisuals.kind, status: content.contentVisuals.status, mime: content.contentVisuals.mime })
    .from(content.contentVisuals)
    .where(eq(content.contentVisuals.ideaId, ideaId))
    .orderBy(desc(content.contentVisuals.createdAt));
  for (const kind of PREFERRED) {
    const ok = rows.find((r) => r.kind === kind && r.status === "ok" && r.mime?.startsWith("image/"));
    if (!ok) continue;
    const [f] = await db.select({ file: content.contentVisuals.file }).from(content.contentVisuals).where(eq(content.contentVisuals.id, ok.id));
    if (f?.file) return { state: "ready", visualId: ok.id, image: Buffer.from(f.file), mime: ok.mime! };
  }
  return rows.some((r) => r.kind === PREFERRED[0]) ? { state: "none" } : { state: "waiting" };
}
