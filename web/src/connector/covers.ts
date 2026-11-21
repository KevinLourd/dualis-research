import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { sql } from "drizzle-orm";
import { displayUrl } from "@/collectors/dimensions/cover-photos";
import type { Db } from "@/db/types";

/**
 * The website's report covers as image files for Thierry's Claude Desktop (Thierry 2026-11-21: reuse the site's
 * visuals on his reports and Substack, and get new ones in the same style for future articles). Drawn here exactly as
 * the site's `Cover` (site/src/components/cover.tsx + `.cover` in globals.css): a Wikimedia Commons photo of the
 * company or its industry, the indigo veil, the shelf, the title in Newsreader, the date, the mark and "Dualis
 * Research". Any size: Substack's post image by default. Never an AI image.
 */
export type CoverPhotoRef = { url: string; credit: string; link: string };
export type CoverSpec = { title: string; shelf: string; date: string | null; photo: CoverPhotoRef | null };
export type CoverSize = { width: number; height: number };

/** Named sizes. Substack: the post image its editor asks for (1456 x 1048, 14:10). */
export const COVER_FORMATS = {
  substack: { width: 1456, height: 1048 },
  site: { width: 1200, height: 1600 },
  x: { width: 1600, height: 900 },
  linkedin: { width: 1200, height: 627 },
  square: { width: 1080, height: 1080 },
} as const satisfies Record<string, CoverSize>;
export type CoverFormat = keyof typeof COVER_FORMATS;

/** The site's shelves (site/src/lib/model.ts CATEGORIES `short`), keyed by gold.content_library.research_category. */
export const SHELVES: Record<string, string> = { coverage: "Deep Dive", primer: "Industry/Thematic Primer", update: "Update", other: "Other" };
const BRAND = "Dualis Research";
const PAGE = "#2B2463";
const VEIL = "23,19,56";
/** The TTF's own family name (Google's static Newsreader, 16pt optical size, the site's default instance). */
const SERIF = "'Newsreader 16pt 16pt'";
const SANS = "'IBM Plex Sans'";
const UA = { "user-agent": "DualisResearch/1.0 (+https://github.com/dualis-research/dualis-research)" };

/** The mark (site/public/brand/mark-white.svg), drawn inline so resvg needs no second file. */
const MARK =
  '<defs><clipPath id="kH0"><circle cx="174.0" cy="82.0" r="39.0"/></clipPath><clipPath id="kH1"><circle cx="82.0" cy="174.0" r="39.0"/></clipPath><mask id="kH" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256"><rect width="256" height="256" fill="#fff"/><rect x="82.0" y="26.0" width="92" height="204" rx="46.0" stroke="#000" stroke-width="52" fill="none" clip-path="url(#kH0)"/><rect x="82.0" y="26.0" width="92" height="204" rx="46.0" stroke="#000" stroke-width="52" fill="none" clip-path="url(#kH1)"/></mask><clipPath id="kV0"><circle cx="82.0" cy="82.0" r="39.0"/></clipPath><clipPath id="kV1"><circle cx="174.0" cy="174.0" r="39.0"/></clipPath><mask id="kV" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256"><rect width="256" height="256" fill="#fff"/><rect x="26.0" y="82.0" width="204" height="92" rx="46.0" stroke="#000" stroke-width="52" fill="none" clip-path="url(#kV0)"/><rect x="26.0" y="82.0" width="204" height="92" rx="46.0" stroke="#000" stroke-width="52" fill="none" clip-path="url(#kV1)"/></mask></defs><g transform="rotate(45 128 128)"><rect x="26.0" y="82.0" width="204" height="92" rx="46.0" stroke="#FFFFFF" stroke-width="34" mask="url(#kH)"/><rect x="82.0" y="26.0" width="92" height="204" rx="46.0" stroke="#FFFFFF" stroke-width="34" mask="url(#kV)"/><rect x="116" y="116" width="24" height="24" fill="#FFFFFF"/></g>';

/** Fonts ship in web/public/fonts (copied beside the standalone server; the server runs from its own folder). */
const FONT_FILE = { [SERIF]: "Newsreader-Regular.ttf", [SANS]: "IBMPlexSans-Regular.ttf" } as Record<string, string>;
const fontPath = (file: string) => path.join(process.cwd(), "public", "fonts", file);
const fontOptions = (families = [SERIF, SANS]) => ({ loadSystemFonts: false, fontFiles: families.map((f) => fontPath(FONT_FILE[f])), defaultFontFamily: "IBM Plex Sans" });
const widths = new Map<string, number>();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Drawn width of one line of text, in px. */
export function textWidth(text: string, size: number, family: string, spacing = 0): number {
  const key = `${family}|${size}|${spacing}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (widths.size > 5000) widths.clear();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="${Math.ceil(size * 2)}"><text x="0" y="${size}" font-family="${family}" font-size="${size}" letter-spacing="${spacing}" fill="#000">${esc(text)}</text></svg>`;
  const box = new Resvg(svg, { font: fontOptions([family]) }).getBBox();
  const w = box ? box.width : text.length * size * 0.5;
  widths.set(key, w);
  return w;
}

/** Greedy word wrap on measured widths, at most `maxLines`, the last one ending "…" when the text is longer. */
export function wrap(text: string, size: number, family: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || textWidth(next, size, family) <= maxWidth) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      let last = lines[maxLines - 1];
      while (last.includes(" ") && textWidth(`${last}…`, size, family) > maxWidth) last = last.slice(0, last.lastIndexOf(" "));
      lines[maxLines - 1] = `${last}…`;
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** "Nov 21, 2026", as the site prints it. */
export function coverDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The cover as SVG. `photoData` = the photo as a data: URI (null = the plain indigo page, as on the site). */
export function coverSvg(spec: CoverSpec, size: CoverSize, photoData: string | null): string {
  const { width: W, height: H } = size;
  // The site's cover is 3:4 and every measure is a share of its width (container units): the same unit here is the
  // width a 3:4 cover of this height would have, so a wide picture keeps the site's proportions, text on the left.
  const u = Math.min(W, H * 0.85) / 100;
  const left = 8 * u;
  const textMax = Math.min(W - 16 * u, Math.max(84 * u, W * 0.6));
  const shelfSize = Math.max(9, 4.4 * u);
  const titleSize = Math.max(13, 8.6 * u);
  const brandSize = Math.max(8, 4 * u);
  const lines = wrap(spec.title, titleSize, SERIF, textMax, 5);
  const shelfY = 8 * u + shelfSize;
  const titleTop = shelfY + 0.04 * textMax + titleSize * 0.2;
  const lineH = titleSize * 1.16;
  const title = lines.map((l, i) => `<tspan x="${left}" y="${titleTop + titleSize * 0.9 + i * lineH}">${esc(l)}</tspan>`).join("");
  const dateY = titleTop + lines.length * lineH + 0.05 * textMax + shelfSize;
  const mark = 9 * u;
  const brandY = H - 7 * u - mark;
  const grey = "rgba(255,255,255,0.78)";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="rgb(${VEIL})" stop-opacity="0.9"/><stop offset="0.34" stop-color="rgb(${VEIL})" stop-opacity="0.62"/>`,
    `<stop offset="0.62" stop-color="rgb(${VEIL})" stop-opacity="0.08"/><stop offset="0.76" stop-color="rgb(${VEIL})" stop-opacity="0.05"/>`,
    `<stop offset="1" stop-color="rgb(${VEIL})" stop-opacity="0.7"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="${PAGE}"/>`,
    photoData ? `<image href="${photoData}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : "",
    `<rect width="${W}" height="${H}" fill="url(#veil)"/>`,
    `<text x="${left}" y="${shelfY}" font-family="${SANS}" font-size="${shelfSize}" fill="${grey}">${esc(spec.shelf)}</text>`,
    `<text font-family="${SERIF}" font-size="${titleSize}" fill="#fff">${title}</text>`,
    spec.date ? `<text x="${left}" y="${dateY}" font-family="${SANS}" font-size="${shelfSize}" fill="${grey}">${esc(spec.date)}</text>` : "",
    `<svg x="${left}" y="${brandY}" width="${mark}" height="${mark}" viewBox="0 0 256 256" fill="none">${MARK}</svg>`,
    `<text x="${left + mark + 0.36 * mark}" y="${brandY + mark / 2 + brandSize * 0.35}" font-family="${SERIF}" font-size="${brandSize}" letter-spacing="${brandSize * 0.08}" fill="#fff">${BRAND}</text>`,
    `</svg>`,
  ].join("");
}

/** Only Wikimedia Commons files: their licence is the one credited (the site's rule: never an AI image). */
export function commonsUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(url);
}

/** The last photos loaded: the preview and the download of one cover read the same file seconds apart. */
const photos = new Map<string, string>();

async function photoDataUri(url: string, f: typeof fetch): Promise<string> {
  const hit = photos.get(url);
  if (hit) return hit;
  if (!commonsUrl(url)) throw new Error("The photo must be a Wikimedia Commons file (upload.wikimedia.org): use find_cover_photos");
  const res = await f(url, { headers: UA });
  if (!res.ok) throw new Error(`Could not load the photo (${res.status}): ${url}`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
  const uri = `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  if (photos.size >= 8) photos.delete(photos.keys().next().value!);
  photos.set(url, uri);
  return uri;
}

/** The cover as a PNG, `scale` x its size (a smaller copy for the chat preview). */
export async function coverPng(spec: CoverSpec, size: CoverSize, opts: { fetch?: typeof fetch; scale?: number } = {}): Promise<Buffer> {
  const photo = spec.photo ? await photoDataUri(spec.photo.url, opts.fetch ?? fetch) : null;
  const svg = coverSvg(spec, size, photo);
  const resvg = new Resvg(svg, { font: fontOptions(), fitTo: { mode: "zoom", value: opts.scale ?? 1 } });
  return Buffer.from(resvg.render().asPng());
}

export function sizeOf(args: { format?: unknown; width?: unknown; height?: unknown }): CoverSize {
  const w = Number(args.width);
  const h = Number(args.height);
  if (args.width !== undefined || args.height !== undefined) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || h < 200 || w > 4000 || h > 4000) throw new Error("width and height: whole pixels between 200 and 4000, both given");
    return { width: w, height: h };
  }
  const name = String(args.format ?? "substack") as CoverFormat;
  if (!(name in COVER_FORMATS)) throw new Error(`format: ${Object.keys(COVER_FORMATS).join(", ")} (or give width and height)`);
  return COVER_FORMATS[name];
}

// ---- His published reports ----------------------------------------------------------------------------------------

export type Report = { id: string; title: string; url: string; publishedAt: string | null; shelf: string; photo: CoverPhotoRef | null };

/** Every own Substack article the website shows (same query as site/src/lib/queries.ts getPublications). */
export async function listReports(db: Db): Promise<Report[]> {
  const rows = (await db.execute(sql`
    select id, url, title, published_at, research_category, cover_photo_url, cover_photo_credit, cover_photo_link
    from gold.content_library
    where publication_kind = 'own' and format = 'substack-article'
    order by published_at desc nulls last, title`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    url: String(r.url),
    publishedAt: r.published_at ? new Date(r.published_at as string).toISOString() : null,
    shelf: SHELVES[String(r.research_category)] ?? "Research",
    photo: r.cover_photo_url ? { url: String(r.cover_photo_url), credit: String(r.cover_photo_credit), link: String(r.cover_photo_link) } : null,
  }));
}

/** A report by id, or by words of its title (one match needed). */
export function pickReport(reports: Report[], query: string): Report {
  const q = query.trim().toLowerCase();
  const byId = reports.find((r) => r.id === query.trim());
  if (byId) return byId;
  const hits = reports.filter((r) => r.title.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new Error(`No report title contains "${query}". Call list_report_covers for the list.`);
  throw new Error(`${hits.length} reports match "${query}": ${hits.map((h) => `"${h.title}"`).join(", ")}. Give more words or the id.`);
}

export const reportSpec = (r: Report): CoverSpec => ({ title: r.title, shelf: r.shelf, date: coverDate(r.publishedAt), photo: r.photo });

// ---- Photos for a new cover ---------------------------------------------------------------------------------------

export type FoundPhoto = { photo_url: string; preview_url: string; title: string; credit: string; link: string; width: number; height: number };

/**
 * Commons photos for a new cover, from the Wikimedia Commons API itself (Openverse, which the website's collector
 * uses from GitHub, answers 403 to the console server). Photos only (jpg / png), at least 1000 px wide, any free
 * licence Commons hosts (all allow commercial use), credited "Photo: <author>, <licence>".
 */
export async function findPhotos(words: string, f: typeof fetch = fetch): Promise<FoundPhoto[]> {
  const q = words.trim();
  if (!q) throw new Error("Give a few words naming what to show (e.g. semiconductor wafer, container port)");
  const res = await f(commonsSearchUrl(q), { headers: UA });
  if (!res.ok) throw new Error(`Photo search failed (${res.status}). Try again in a minute.`);
  return parseCommons((await res.json()) as CommonsAnswer);
}

export function commonsSearchUrl(q: string): string {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|Artist|ObjectName",
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

type CommonsAnswer = {
  query?: {
    pages?: Record<
      string,
      {
        index?: number;
        title?: string;
        imageinfo?: { url: string; width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[];
      }
    >;
  };
};

const plain = (html: string | undefined) => (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function parseCommons(body: CommonsAnswer): FoundPhoto[] {
  const pages = Object.values(body.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: FoundPhoto[] = [];
  for (const p of pages) {
    const i = p.imageinfo?.[0];
    if (!i || !/^image\/(jpeg|png)$/.test(i.mime) || i.width < 1000) continue;
    const url = i.url.split("?")[0];
    if (!commonsUrl(url)) continue;
    const m = i.extmetadata ?? {};
    const licence = plain(m.LicenseShortName?.value) || "Wikimedia Commons";
    const author = plain(m.Artist?.value) || "Wikimedia Commons";
    out.push({
      photo_url: displayUrl({ url, width: i.width }, 2048),
      preview_url: displayUrl({ url, width: i.width }, 640),
      title: plain(m.ObjectName?.value) || String(p.title ?? "").replace(/^File:/, ""),
      credit: `Photo: ${author}, ${licence}`,
      link: i.descriptionurl,
      width: i.width,
      height: i.height,
    });
    if (out.length === 10) break;
  }
  return out;
}
