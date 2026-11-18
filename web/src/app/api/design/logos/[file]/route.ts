import { logoPng, PNG_SIZES, type PngSize, tightSvg } from "@/design/logo-export";
import { getLogoSource } from "@/design/queries";

export const dynamic = "force-dynamic";

/**
 * One logo of the Design system page as a file to upload anywhere (GitHub, X, Substack, LinkedIn, a deck):
 * `/api/design/logos/dualis-mark.png?size=1024` or `.svg`, cropped to the artwork, made from the SVG on GitHub main.
 * Signed-in like every console route; `?download=1` saves it as `<name>[-<size>].<ext>`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^([a-z0-9-]+)\.(png|svg)$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const [, name, ext] = m;
  const url = new URL(req.url);
  const size = Number(url.searchParams.get("size") ?? 1024);
  if (ext === "png" && !PNG_SIZES.includes(size as PngSize)) return new Response(`size must be one of ${PNG_SIZES.join(", ")}`, { status: 400 });
  const source = await getLogoSource(name);
  if (!source) return new Response("Not found", { status: 404 });

  const body = ext === "png" ? new Uint8Array(logoPng(source, size as PngSize)) : tightSvg(source);
  const headers = new Headers({
    "content-type": ext === "png" ? "image/png" : "image/svg+xml; charset=utf-8",
    "cache-control": "private, max-age=300",
  });
  if (url.searchParams.has("download")) headers.set("content-disposition", `attachment; filename="${name}${ext === "png" ? `-${size}` : ""}.${ext}"`);
  return new Response(body, { headers });
}
