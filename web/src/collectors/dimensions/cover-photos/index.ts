import { and, eq, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { judge } from "@/llm/judge";
import { rebuildGoldContent } from "../content-posts";
import { COVER_DIMENSION, type CoverPhoto } from "../content-posts/cover";

export { COVER_DIMENSION };
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";

/**
 * The photo behind each of Thierry's report covers on the website (Thierry 2026-11-06: the navy constellation
 * replaced by "an image that represents the brand or the industry"). Free and keyless: Openverse's search over
 * Wikimedia Commons, commercial-use licences only. Per own article, ONCE: Claude names what to photograph, Openverse
 * returns candidates (bronze), Claude picks one (silver.judgments), the pick is a `cover-photo` fact read into
 * gold.content_library. Bump COVER_PICK_KEY (and delete the facts) to pick again.
 */
export const OPENVERSE_SOURCE = "openverse";
export const COVER_PICK_KEY = "cover-photo@v1";
const SUBJECT_KIND = "content-post";
const OPENVERSE = "https://api.openverse.org/v1/images/";
const HEADERS = { "user-agent": "DualisResearch/1.0 (+https://github.com/KevinLourd/dualis-research)" };
/** Width served on the site: sharp on a 2x screen at the biggest cover size, light enough for a list of them. */
export const DISPLAY_WIDTH = 1280;

export type PhotoCandidate = {
  id: string;
  title: string;
  creator: string | null;
  license: string;
  licenseVersion: string | null;
  /** The Commons page of the file: the credit links there. */
  landing: string;
  /** Original file on upload.wikimedia.org. */
  url: string;
  width: number;
  height: number;
};

const QUERY_SYSTEM = [
  "You choose image-search terms for the cover photo of an equity research report.",
  "The photo must show what the report is about: the company's product, its plant or equipment, the commodity, or the city or market it trades in.",
  "Give 3 searches, most specific first, each 1 to 3 plain English words naming a concrete thing a photographer can shoot.",
  "Never a person, a logo, a chart, a brand name, or an abstract word (growth, investment, value, finance).",
  'Answer with JSON only: {"queries": ["...", "...", "..."]}',
].join(" ");

const PICK_QUESTION = [
  "Which photo should sit behind this research report's cover title, to show at a glance the company or the industry it covers?",
  "Prefer a sharp, professional photograph of the product, the plant, the equipment, the commodity or the place.",
  "Never pick a chart, a diagram, a map, a sign, a logo, a scanned document, a person, or a photo whose title names an unrelated subject.",
].join(" ");

/** The open Openverse search: Wikimedia Commons only (hotlinkable, stable), licences that allow commercial use. */
export function openverseUrl(q: string): string {
  const p = new URLSearchParams({ q, source: "wikimedia", license_type: "commercial", size: "large", extension: "jpg", mature: "false", page_size: "8" });
  return `${OPENVERSE}?${p}`;
}

/** Commons serves any width of a file under /thumb/; a file narrower than the target is served as is. */
export function displayUrl(c: Pick<PhotoCandidate, "url" | "width">, width = DISPLAY_WIDTH): string {
  const m = c.url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/);
  if (!m || c.width <= width) return c.url;
  return `${m[1]}/thumb/${m[2]}/${m[3]}/${width}px-${m[3]}`;
}

/** "Photo: Jane Doe, CC BY-SA 4.0" (CC0 and public domain need no version). */
export function creditLine(c: Pick<PhotoCandidate, "creator" | "license" | "licenseVersion">): string {
  const lic = c.license.toLowerCase();
  const name = lic === "cc0" ? "CC0" : lic === "pdm" ? "Public domain" : `CC ${lic.toUpperCase()}${c.licenseVersion ? ` ${c.licenseVersion}` : ""}`;
  const who = c.creator?.replace(/<[^>]+>/g, "").trim();
  return `Photo: ${who || "Wikimedia Commons"}, ${name}`;
}

export function parseQueries(text: string): string[] {
  const o = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { queries?: unknown };
  const qs = Array.isArray(o.queries) ? o.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim()) : [];
  if (qs.length === 0) throw new Error(`no search terms in the answer: ${text.slice(0, 200)}`);
  return qs.slice(0, 3);
}

function toCandidate(r: Record<string, unknown>): PhotoCandidate | null {
  const url = typeof r.url === "string" ? r.url : null;
  const width = Number(r.width);
  const height = Number(r.height);
  if (!url || !url.startsWith("https://upload.wikimedia.org/") || !width || !height) return null;
  return {
    id: String(r.id),
    title: String(r.title ?? "").replace(/<[^>]+>/g, "").replace(/^File:/, "").trim(),
    creator: typeof r.creator === "string" ? r.creator : null,
    license: String(r.license),
    licenseVersion: typeof r.license_version === "string" ? r.license_version : null,
    landing: String(r.foreign_landing_url ?? url),
    url,
    width,
    height,
  };
}

/** One own article: Claude's search terms, then every Openverse answer, in one bronze row. */
export const openverse: Source = {
  name: OPENVERSE_SOURCE,
  requiredEnv: [],
  covers: () => true,
  fetch: async (postId, ctx): Promise<FetchOutcome> => {
    if (!ctx.db) throw new Error("cover-photos: the runner must pass ctx.db");
    if (!ctx.complete) throw new Error("cover-photos: no LLM is set (ctx.complete)");
    const [post] = await ctx.db.select().from(content.contentPosts).where(eq(content.contentPosts.id, postId));
    if (!post) return { request: { postId }, httpStatus: null, error: `post ${postId} not found` };
    const { text } = await ctx.complete({ system: QUERY_SYSTEM, prompt: articleText(post) });
    const queries = parseQueries(text);
    const urls = queries.map(openverseUrl);
    const seen = new Set<string>();
    const candidates: PhotoCandidate[] = [];
    let lastStatus: number | null = null;
    for (const url of urls) {
      const res = await ctx.fetch(url, { headers: HEADERS });
      lastStatus = res.status;
      if (!res.ok) return { request: { postId, queries, urls }, httpStatus: res.status, payloadText: await res.text(), error: `openverse ${res.status} on "${url}"` };
      const body = (await res.json()) as { results?: Record<string, unknown>[] };
      for (const r of body.results ?? []) {
        const c = toCandidate(r);
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          candidates.push(c);
        }
      }
    }
    const request = { postId, queries, urls };
    if (candidates.length === 0) return { request, httpStatus: lastStatus, payload: { queries, candidates }, error: `no photo found for ${queries.join(" / ")}` };
    return { request, httpStatus: lastStatus, payload: { queries, candidates } };
  },
};

function articleText(p: content.SilverContentPost): string {
  return [`Title: ${p.title}`, p.subtitle ? `Subtitle: ${p.subtitle}` : null, p.tickers.length ? `Tickers: ${p.tickers.join(", ")}` : null, p.excerpt ? `Opening text: ${p.excerpt}` : null]
    .filter(Boolean)
    .join("\n");
}

/** Own Substack articles without a cover photo yet. */
export async function postsWithoutPhoto(db: Db): Promise<string[]> {
  const own = (await db.select({ host: content.contentPublications.host }).from(content.contentPublications).where(eq(content.contentPublications.kind, "own"))).map((p) => p.host);
  if (own.length === 0) return [];
  const posts = await db
    .select({ id: content.contentPosts.id })
    .from(content.contentPosts)
    .where(and(inArray(content.contentPosts.publicationHost, own), eq(content.contentPosts.format, "substack-article")));
  const done = new Set((await db.select({ subject: facts.subject }).from(facts).where(eq(facts.dimension, COVER_DIMENSION))).map((f) => f.subject));
  return posts.map((p) => p.id).filter((id) => !done.has(id));
}

export const coverPhotos: Dimension = {
  name: COVER_DIMENSION,
  description: "A photo of the company or its industry behind each of Thierry's report covers (Wikimedia Commons via Openverse, picked once by Claude).",
  sources: [openverse],
  subjects: postsWithoutPhoto,
  promote: promoteCoverPhotos,
};

export async function promoteCoverPhotos(db: Db, rows: BronzeFetch[], ctx: SourceContext): Promise<PromoteResult> {
  let picked = 0;
  for (const f of rows.filter((r) => !r.error && r.source === OPENVERSE_SOURCE)) {
    const { candidates } = f.payload as { candidates: PhotoCandidate[] };
    const [post] = await db.select().from(content.contentPosts).where(eq(content.contentPosts.id, f.subject));
    if (!post || candidates.length === 0) continue;
    if (!ctx.complete) throw new Error("cover-photos: a photo needs picking and no LLM is set (ctx.complete)");
    const verdict = await judge(
      db,
      {
        subjectKind: SUBJECT_KIND,
        subjectId: post.id,
        questionKey: COVER_PICK_KEY,
        question: PICK_QUESTION,
        input: `${articleText(post)}\n\nPhotos (id: title, size):\n${candidates.map((c) => `${c.id}: ${c.title} (${c.width}x${c.height})`).join("\n")}`,
        choices: candidates.map((c) => c.id),
      },
      ctx.complete,
    );
    const c = candidates.find((x) => x.id === verdict.verdict);
    if (!c) throw new Error(`cover-photos: the stored pick "${verdict.verdict}" for post ${post.id} is not among this fetch's candidates`);
    const photo: CoverPhoto = { url: displayUrl(c), credit: creditLine(c), link: c.landing, title: c.title, width: c.width, height: c.height };
    await db
      .insert(facts)
      .values({ dimension: COVER_DIMENSION, subject: post.id, field: "photo", value: photo, valueKey: c.id, sources: [OPENVERSE_SOURCE], bronzeIds: [f.id] })
      .onConflictDoUpdate({ target: [facts.dimension, facts.subject, facts.field, facts.valueKey], set: { value: photo, bronzeIds: [f.id], lastSeenAt: new Date() } });
    picked++;
  }
  await rebuildGoldContent(db);
  return { silverRowsBySource: { [OPENVERSE_SOURCE]: picked } };
}
