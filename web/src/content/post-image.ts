import { desc, eq } from "drizzle-orm";
import * as content from "@/db/schema/content";
import type { VisualKind } from "@/db/schema/content";
import type { Db } from "@/db/types";

/**
 * The image a post goes out with on WhatsApp (content-visuals): a Substack Note is a paragraph with its chart (#59), an X
 * post carries the 16:9 post card; each falls back on the other.
 */
const PREFERRED: Record<string, readonly VisualKind[]> = { "substack-note": ["chart", "montage"] };
const DEFAULT: readonly VisualKind[] = ["montage", "chart"];

export type PostImage = { state: "ready"; visualId: string; image: Buffer; mime: string } | { state: "waiting" } | { state: "none" };

/**
 * The newest image bytes from silver (gold keeps no bytes), first choice first; "waiting" (only when `waitForFirst`)
 * while content-visuals has not drawn the first choice yet; "none" when no picture exists.
 */
export async function postImage(db: Db, ideaId: string | null, format: string, waitForFirst = false): Promise<PostImage> {
  if (!ideaId) return { state: "none" };
  const kinds = PREFERRED[format] ?? DEFAULT;
  const rows = await db
    .select({ id: content.contentVisuals.id, kind: content.contentVisuals.kind, status: content.contentVisuals.status, mime: content.contentVisuals.mime })
    .from(content.contentVisuals)
    .where(eq(content.contentVisuals.ideaId, ideaId))
    .orderBy(desc(content.contentVisuals.createdAt));
  // While the first choice is not drawn yet, wait for it rather than send the fallback.
  if (waitForFirst && !rows.some((r) => r.kind === kinds[0])) return { state: "waiting" };
  for (const kind of kinds) {
    const ok = rows.find((r) => r.kind === kind && r.status === "ok" && r.mime?.startsWith("image/"));
    if (!ok) continue;
    const [f] = await db.select({ file: content.contentVisuals.file }).from(content.contentVisuals).where(eq(content.contentVisuals.id, ok.id));
    if (f?.file) return { state: "ready", visualId: ok.id, image: Buffer.from(f.file), mime: ok.mime! };
  }
  return { state: "none" };
}
