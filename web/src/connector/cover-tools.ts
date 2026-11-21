import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import {
  commonsUrl,
  COVER_FORMATS,
  coverDate,
  coverPng,
  type CoverSize,
  type CoverSpec,
  findPhotos,
  listReports,
  pickReport,
  reportSpec,
  SHELVES,
  sizeOf,
} from "./covers";
import { CONSOLE_URL, seal } from "./oauth";

/**
 * Report covers through the connector (Thierry 2026-11-21): the website's cover of any report he published, in the
 * size he asks (Substack by default), and new covers in the same style for his next articles. Each answer shows a
 * small preview in the chat and gives a download link to the full-size PNG (no sign-in, sealed, valid 30 days).
 */
export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type CoverResult = { content: Content[]; isError?: boolean };
export type CoverToolDeps = { db?: Db; fetch?: typeof fetch; env?: Record<string, string | undefined> };

const LINK_DAYS = 30;
const PREVIEW_WIDTH = 640;
const FORMAT = {
  type: "string",
  enum: Object.keys(COVER_FORMATS),
  description: `Picture size: ${Object.entries(COVER_FORMATS)
    .map(([k, v]) => `${k} ${v.width}x${v.height}`)
    .join(", ")}. Default substack. Or give width and height instead.`,
};
const PX = { type: "integer", minimum: 200, maximum: 4000 };

export const COVER_TOOLS = [
  {
    name: "list_report_covers",
    description: "List Thierry's published reports that have a cover on the website (title, date, shelf, id). Use it to find the report whose cover he wants.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_report_cover",
    description:
      "The website's cover of one of Thierry's published reports, as a PNG in the size he wants (Substack post image by default). Shows a preview and gives a download link to the full-size file. Give the report's id or a few words of its title.",
    inputSchema: {
      type: "object",
      properties: { report: { type: "string", description: "The report's id, or words of its title." }, format: FORMAT, width: PX, height: PX },
      required: ["report"],
      additionalProperties: false,
    },
  },
  {
    name: "find_cover_photos",
    description:
      "Find photos for a NEW report cover, from Wikimedia Commons (free for commercial use, the same source as the website's covers). Search 1 to 3 plain words naming a concrete thing to show: the product, the plant or equipment, the commodity, the place (never a person, logo, chart or abstract word). Returns photos with a preview link; show Thierry the previews and let him pick, then call make_cover.",
    inputSchema: { type: "object", properties: { words: { type: "string", description: "e.g. semiconductor wafer, container port, oil refinery" } }, required: ["words"], additionalProperties: false },
  },
  {
    name: "make_cover",
    description:
      "Make a NEW cover in the website's style for an article Thierry is writing: his title, the shelf, the date, and a photo from find_cover_photos. PNG in the size he wants (Substack by default), with a preview and a download link. Put the photo credit it returns under the picture on Substack.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The article's title, as he will publish it." },
        shelf: { type: "string", enum: Object.values(SHELVES), description: "Which kind of research it is. Default Deep Dive." },
        date: { type: "string", description: "Publication date YYYY-MM-DD. Default today." },
        photo_url: { type: "string", description: "photo_url of the chosen photo from find_cover_photos. Leave out for a plain indigo cover." },
        photo_credit: { type: "string", description: "credit of that photo, from find_cover_photos." },
        photo_link: { type: "string", description: "link of that photo, from find_cover_photos." },
        format: FORMAT,
        width: PX,
        height: PX,
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
] as const;

/** The full-size file's link: the cover's whole recipe, sealed, so the route needs no sign-in and no storage. */
export function coverLink(spec: CoverSpec, size: CoverSize, env?: Record<string, string | undefined>): string {
  const token = seal({ k: "cover", exp: Math.floor(Date.now() / 1000) + LINK_DAYS * 86400, s: spec, z: size }, env);
  return `${CONSOLE_URL}/covers/${token}.png`;
}

function fileName(title: string, size: CoverSize): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "cover";
  return `${slug}-${size.width}x${size.height}.png`;
}

async function answer(spec: CoverSpec, size: CoverSize, deps: CoverToolDeps): Promise<CoverResult> {
  const preview = await coverPng(spec, size, { fetch: deps.fetch, scale: Math.min(1, PREVIEW_WIDTH / size.width) });
  const link = `${coverLink(spec, size, deps.env)}?name=${encodeURIComponent(fileName(spec.title, size))}`;
  const credit = spec.photo ? `\nPhoto credit to put under the picture: ${spec.photo.credit} (${spec.photo.link})` : "";
  return {
    content: [
      { type: "image", data: preview.toString("base64"), mimeType: "image/png" },
      { type: "text", text: `Cover "${spec.title}", ${size.width}x${size.height} px. Full-size PNG to download (link valid ${LINK_DAYS} days, give it to Thierry as is): ${link}${credit}` },
    ],
  };
}

export async function callCoverTool(name: string, args: Record<string, unknown>, deps: CoverToolDeps = {}): Promise<CoverResult | null> {
  const db = () => deps.db ?? getDb();
  switch (name) {
    case "list_report_covers": {
      const reports = await listReports(db());
      if (!reports.length) return { content: [{ type: "text", text: "No published report yet." }] };
      const lines = reports.map((r) => `- ${r.title} (${r.shelf}, ${coverDate(r.publishedAt) ?? "no date"}${r.photo ? "" : ", plain indigo cover"}) id ${r.id}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    case "get_report_cover": {
      const report = pickReport(await listReports(db()), String(args.report ?? ""));
      return answer(reportSpec(report), sizeOf(args), deps);
    }
    case "find_cover_photos": {
      const photos = await findPhotos(String(args.words ?? ""), deps.fetch);
      if (!photos.length) return { content: [{ type: "text", text: `No photo found for "${String(args.words)}". Try other words (one concrete thing).` }] };
      return { content: [{ type: "text", text: JSON.stringify(photos, null, 1) }] };
    }
    case "make_cover": {
      const title = String(args.title ?? "").trim();
      if (!title) throw new Error("Give the article's title");
      if (title.length > 200) throw new Error("The title must be at most 200 characters");
      const shelf = args.shelf ? String(args.shelf) : SHELVES.coverage;
      if (!Object.values(SHELVES).includes(shelf)) throw new Error(`shelf: ${Object.values(SHELVES).join(", ")}`);
      const date = args.date ? String(args.date) : new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date: YYYY-MM-DD");
      let photo: CoverSpec["photo"] = null;
      if (args.photo_url !== undefined) {
        if (!commonsUrl(args.photo_url)) throw new Error("photo_url must be a photo_url returned by find_cover_photos (a Wikimedia Commons file)");
        photo = { url: args.photo_url, credit: String(args.photo_credit ?? "Photo: Wikimedia Commons"), link: String(args.photo_link ?? args.photo_url) };
      }
      return answer({ title, shelf, date: coverDate(date), photo }, sizeOf(args), deps);
    }
  }
  return null;
}
