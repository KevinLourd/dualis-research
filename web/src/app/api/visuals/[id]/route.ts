import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contentVisuals } from "@/db/schema/content";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" };

/**
 * The file of one visual (Content > Drafts panel): signed-in only, cached by the browser for a year (a visual never
 * changes: a new look is a new row). `?download=1` saves it as `<symbol-or-idea>-<kind>.<ext>`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [v] = await getDb()
    .select({ file: contentVisuals.file, mime: contentVisuals.mime, kind: contentVisuals.kind })
    .from(contentVisuals)
    .where(and(eq(contentVisuals.id, id), eq(contentVisuals.status, "ok")));
  if (!v?.file || !v.mime) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "content-type": v.mime, "cache-control": "private, max-age=31536000, immutable" });
  const name = new URL(req.url).searchParams.get("name");
  if (new URL(req.url).searchParams.has("download")) headers.set("content-disposition", `attachment; filename="${(name ?? "dualis").replace(/[^\w.-]/g, "_")}-${v.kind}.${EXT[v.mime] ?? "bin"}"`);
  return new Response(new Uint8Array(v.file), { headers });
}
