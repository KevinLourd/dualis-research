import { and, desc, eq, getTableColumns, inArray, isNotNull, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import { VISUAL_KINDS, type VisualKind } from "@/db/schema/content";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { chooseChart } from "./choose";
import { MIN_BARS, type VisualInput, visualInput } from "./data";

export const VISUALS_DIMENSION = "content-visuals";
/** Bump to render every Idea again (a new look). */
// v2 (Thierry 2026-11-06): the chart shows the driver's most striking Exhibit, the price only when the Idea is about price.
export const VISUALS_VERSION = "visuals-v2";
export const RENDER_SOURCE = "render";
export const CAPTURE_SOURCE = "capture";
const RETRY_FAILED_AFTER_MS = 20 * 3600_000;

/** Node-only modules (resvg, ffmpeg, Chrome) are loaded by URL: the console bundle never sees them. */
const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);
const renderModule = async () => (await nodeImport(new URL("./render.ts", import.meta.url).href)) as typeof import("./render");
const captureModule = async () => (await nodeImport(new URL("./capture.ts", import.meta.url).href)) as typeof import("./capture");

type Rendered = {
  file: Buffer;
  mime: string;
  width: number;
  height: number;
  sourceUrl: string | null;
  caption: string;
};
/** Files made in this run, keyed on subject: promotion stores them (bronze keeps what they were made from, not the bytes). */
const rendered = new Map<string, Rendered>();

const subjectOf = (ideaId: string, kind: VisualKind) => `idea:${ideaId}#${kind}`;
function parseSubject(subject: string): { ideaId: string; kind: VisualKind } {
  const m = /^idea:([0-9a-f-]{36})#(\w+)$/.exec(subject);
  if (!m || !(VISUAL_KINDS as readonly string[]).includes(m[2])) throw new Error(`bad subject ${subject}`);
  return { ideaId: m[1], kind: m[2] as VisualKind };
}

async function inputFor(db: Db, ideaId: string): Promise<VisualInput> {
  const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, ideaId));
  if (!idea) throw new Error(`idea ${ideaId} not found`);
  return visualInput(db, idea);
}

function summary(input: VisualInput) {
  return {
    symbol: input.symbol,
    title: input.title,
    closes: input.bars.length,
    first: input.bars[0]?.date ?? null,
    last: input.bars.at(-1)?.date ?? null,
    fair: input.fair,
    newsUrl: input.newsUrl,
    exhibits: input.exhibits.map((e) => e.id),
  };
}

/** Chart, card and video, drawn from gold (no network). */
export const renderSource: Source = {
  name: RENDER_SOURCE,
  requiredEnv: [],
  covers: (subject) => !subject.endsWith("#capture"),
  async fetch(subject, ctx) {
    if (!ctx.db) throw new Error("no database in the collector context");
    const { ideaId, kind } = parseSubject(subject);
    const input = await inputFor(ctx.db, ideaId);
    // The chart draws the driver the Idea cites (its most striking Exhibit), the price only when the Idea is about price.
    const choice = kind === "chart" ? await chooseChart(ctx.db, ideaId, input, ctx.complete) : null;
    const request = {
      version: VISUALS_VERSION,
      ideaId,
      kind,
      input: summary(input),
      ...(choice ? { chart: choice.kind === "exhibit" ? { exhibitId: choice.exhibit.id, why: choice.reason } : { exhibitId: null, why: choice.reason } } : {}),
    };
    if (choice?.kind === "exhibit") {
      const r = await renderModule();
      const file = r.png(r.exhibitSvg(input, choice.exhibit));
      const out: Rendered = { file, mime: "image/png", width: r.W, height: r.H, sourceUrl: null, caption: `Exhibit: ${choice.exhibit.title}` };
      rendered.set(subject, out);
      return { request, httpStatus: null, payload: { mime: out.mime, width: out.width, height: out.height, sizeBytes: file.length } };
    }
    if (input.bars.length < MIN_BARS)
      return {
        request,
        httpStatus: null,
        error: `only ${input.bars.length} closes for ${input.symbol} in the last 12 months (a chart needs ${MIN_BARS})`,
      };
    const r = await renderModule();
    const file = kind === "video" ? await r.video(input) : r.png(kind === "chart" ? r.chartSvg(input) : r.montageSvg(input));
    const out: Rendered = {
      file,
      mime: kind === "video" ? "video/mp4" : "image/png",
      width: r.W,
      height: r.H,
      sourceUrl: null,
      caption: `Prices: ${input.priceSources.join(", ")}`,
    };
    rendered.set(subject, out);
    return {
      request,
      httpStatus: null,
      payload: {
        mime: out.mime,
        width: out.width,
        height: out.height,
        sizeBytes: file.length,
      },
    };
  },
};

/** A screenshot of the news page the Idea cites. */
export const captureSource: Source = {
  name: CAPTURE_SOURCE,
  requiredEnv: [],
  covers: (subject) => subject.endsWith("#capture"),
  async fetch(subject, ctx) {
    if (!ctx.db) throw new Error("no database in the collector context");
    const { ideaId } = parseSubject(subject);
    const input = await inputFor(ctx.db, ideaId);
    const request = {
      version: VISUALS_VERSION,
      ideaId,
      kind: "capture",
      url: input.newsUrl,
    };
    if (!input.newsUrl)
      return {
        request,
        httpStatus: null,
        error: "the idea cites no news with a link",
      };
    const { file, finalUrl } = await (await captureModule()).capture(input.newsUrl);
    const host = new URL(finalUrl).hostname.replace(/^www\./, "");
    rendered.set(subject, {
      file,
      mime: "image/jpeg",
      width: 1280,
      height: 720,
      sourceUrl: finalUrl,
      caption: `Capture of ${host}`,
    });
    return {
      request,
      httpStatus: 200,
      payload: {
        mime: "image/jpeg",
        width: 1280,
        height: 720,
        sizeBytes: file.length,
        finalUrl,
      },
    };
  },
};

/**
 * Every Idea that has a draft and lacks one of its visuals at this version: montage, video and chart always; a
 * capture only when the Idea cites a news item with a link.
 */
export async function pickVisualSubjects(db: Db): Promise<string[]> {
  rendered.clear();
  const drafted = await db.selectDistinct({ ideaId: content.contentDrafts.ideaId }).from(content.contentDrafts).where(isNotNull(content.contentDrafts.ideaId));
  const ideaIds = drafted.map((d) => d.ideaId!);
  if (ideaIds.length === 0) return [];
  const done = new Set(
    (
      await db
        .select({
          ideaId: content.contentVisuals.ideaId,
          kind: content.contentVisuals.kind,
          status: content.contentVisuals.status,
          createdAt: content.contentVisuals.createdAt,
        })
        .from(content.contentVisuals)
        .where(and(inArray(content.contentVisuals.ideaId, ideaIds), eq(content.contentVisuals.version, VISUALS_VERSION)))
    )
      // A failure is tried again once it is a day old (a news site down, a runner without ffmpeg).
      .filter((v) => v.status === "ok" || Date.now() - v.createdAt.getTime() < RETRY_FAILED_AFTER_MS)
      .map((v) => subjectOf(v.ideaId, v.kind)),
  );
  const ideas = await db
    .select({
      id: content.contentIdeas.id,
      refs: content.contentIdeas.sourceRefs,
    })
    .from(content.contentIdeas)
    .where(inArray(content.contentIdeas.id, ideaIds));
  const out: string[] = [];
  for (const i of ideas) {
    const kinds: VisualKind[] = ["montage", "video", "chart", ...(i.refs.some((r) => r.kind === "evidence") ? (["capture"] as const) : [])];
    for (const k of kinds) if (!done.has(subjectOf(i.id, k))) out.push(subjectOf(i.id, k));
  }
  return out;
}

/** Bronze row + the file made in this run -> silver.content_visuals (a failure is a row too, with its reason) -> gold. */
export async function promoteVisuals(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  const counts: Record<string, number> = {
    [RENDER_SOURCE]: 0,
    [CAPTURE_SOURCE]: 0,
  };
  for (const f of rows.filter((r) => r.source === RENDER_SOURCE || r.source === CAPTURE_SOURCE)) {
    const { ideaId, kind } = parseSubject(f.subject);
    const file = rendered.get(f.subject);
    const ok = !f.error && !!file;
    const row = {
      ideaId,
      kind,
      version: VISUALS_VERSION,
      status: (ok ? "ok" : "failed") as "ok" | "failed",
      error: ok ? null : (f.error ?? "the file was not kept by this run"),
      mime: file?.mime ?? null,
      width: file?.width ?? null,
      height: file?.height ?? null,
      file: ok ? file!.file : null,
      sizeBytes: file?.file.length ?? null,
      sourceUrl: file?.sourceUrl ?? null,
      caption: file?.caption ?? null,
      sources: [f.source],
      bronzeIds: [f.id],
      createdAt: new Date(),
    };
    // Stored once; a failed one is replaced by its retry.
    const written = await db
      .insert(content.contentVisuals)
      .values(row)
      .onConflictDoUpdate({
        target: [content.contentVisuals.ideaId, content.contentVisuals.kind, content.contentVisuals.version],
        set: row,
        setWhere: sql`${content.contentVisuals.status} = 'failed'`,
      })
      .returning({ id: content.contentVisuals.id });
    counts[f.source] += written.length;
  }
  await rebuildGoldVisuals(db);
  return { silverRowsBySource: counts };
}

/** gold.content_visuals = the latest version per (idea, kind), without the file. */
export async function rebuildGoldVisuals(db: Db): Promise<void> {
  // Never read the files back (Neon egress): every column but `file`.
  const cols = Object.fromEntries(Object.entries(getTableColumns(content.contentVisuals)).filter(([k]) => k !== "file")) as Omit<ReturnType<typeof getTableColumns<typeof content.contentVisuals>>, "file">;
  const all = await db.select(cols).from(content.contentVisuals).orderBy(desc(content.contentVisuals.createdAt));
  const latest = new Map<string, (typeof all)[number]>();
  for (const v of all) if (!latest.has(`${v.ideaId}#${v.kind}`)) latest.set(`${v.ideaId}#${v.kind}`, v);
  await db.transaction(async (tx) => {
    await tx.delete(content.goldContentVisuals);
    if (latest.size === 0) return;
    await tx.insert(content.goldContentVisuals).values(
      [...latest.values()].map((v) => ({
        id: v.id,
        ideaId: v.ideaId,
        kind: v.kind,
        status: v.status,
        error: v.error,
        mime: v.mime,
        width: v.width,
        height: v.height,
        sizeBytes: v.sizeBytes,
        sourceUrl: v.sourceUrl,
        caption: v.caption,
        createdAt: v.createdAt,
      })),
    );
  });
}

export const contentVisuals: Dimension = {
  name: VISUALS_DIMENSION,
  description: "Visuals of every drafted Idea: the chart of the driver it cites (its most striking Exhibit, or price vs fair value when the Idea is about price), 16:9 post card, the card as a short video, and a capture of the news it cites.",
  sources: [renderSource, captureSource],
  subjects: pickVisualSubjects,
  promote: promoteVisuals,
};
