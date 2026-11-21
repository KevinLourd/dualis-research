import { coverPng, type CoverSize, type CoverSpec } from "@/connector/covers";
import { unseal } from "@/connector/oauth";

export const dynamic = "force-dynamic";

/**
 * A report cover's full-size PNG, from a link the connector gave Thierry's Claude (`/covers/<sealed recipe>.png`):
 * the recipe is sealed with MCP_OAUTH_KEY and expires, so no sign-in and nothing stored. `?name=` names the file.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([A-Za-z0-9_-]+)\.png$/.exec(file);
  const payload = m ? unseal<{ k: "cover"; s: CoverSpec; z: CoverSize }>(m[1], "cover") : null;
  if (!payload) return new Response("This cover link is wrong or has expired: ask Claude for the cover again.", { status: 404 });
  const png = await coverPng(payload.s, payload.z);
  const name = (new URL(req.url).searchParams.get("name") ?? "dualis-cover.png").replace(/[^A-Za-z0-9._-]/g, "") || "dualis-cover.png";
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "content-disposition": `inline; filename="${name}"` },
  });
}
