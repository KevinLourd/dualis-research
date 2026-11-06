import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { goldCatalysts } from "@/db/schema/catalysts";
import * as content from "@/db/schema/content";
import type { DraftChart, DraftInputs } from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import { goldNewsItems } from "@/db/schema/news";
import { theses as goldTheses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { activeAccounts } from "../content-accounts";
import { voiceGuides } from "../content-voices";
import { chartOptions, type ChartOption } from "./charts";
import { type DraftFormat, draftPrompt, draftSystem, parseGeneration, PROMPT_VERSION, withDisclaimer } from "./format";

export const DRAFTS_DIMENSION = "content-drafts";
export const CLAUDE_SOURCE = "claude";
/** A catalyst older than this is not fresh enough to post about (the day's window plus the night before). */
const FRESH_HOURS = 36;
/** The day's drafts are spread over this window, until the next morning collection. */
export const SLOT_WINDOW_HOURS = 24;

/** Formats written per channel; a channel with no account still gets an unassigned draft. */
const FORMATS_BY_CHANNEL: Record<string, DraftFormat[]> = {
  x: ["x-post"],
  linkedin: ["linkedin-post"],
  substack: ["substack-note", "substack-article"],
};

type Prepared = {
  inputs: DraftInputs;
  narrative: string | null;
  newsSummary: string | null;
  format: DraftFormat;
  account: { id: string; name: string } | null;
  voiceGuide: string | null;
  exhibits: ChartOption[];
};
/** What one generation needs; kept between `subjects` (which reads the database) and the source's fetch. */
const prepared = new Map<string, Prepared>();

/** One LLM call per (catalyst, account, format), in that account's voice. The raw answer lands in bronze. */
export const claudeDrafts: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: 4,
  async fetch(subject, ctx) {
    const p = prepared.get(subject);
    if (!p) throw new Error(`no prepared inputs for ${subject}`);
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    const system = draftSystem(p.format, p.voiceGuide, p.account?.name ?? null);
    const prompt = draftPrompt(p.inputs, p.narrative, p.newsSummary, p.exhibits.map((x) => ({ id: x.id, label: x.label })));
    const { text, model } = await ctx.complete({ system, prompt });
    const request = {
      promptVersion: PROMPT_VERSION,
      model,
      format: p.format,
      accountId: p.account?.id ?? null,
      inputs: p.inputs,
      narrative: p.narrative,
      // The exhibit data offered, snapshot from gold: promotion builds the charts from it, never from a later read.
      exhibits: p.exhibits,
      prompt,
    };
    const outcome = { request, httpStatus: null, payloadText: text };
    try {
      parseGeneration(p.format, text, p.exhibits.map((x) => x.id));
    } catch (err) {
      return { ...outcome, error: `answer is not the expected ${p.format}: ${err instanceof Error ? err.message : String(err)}` };
    }
    return outcome;
  },
};

export const contentDrafts: Dimension = {
  name: DRAFTS_DIMENSION,
  description: "Drafts for every news that cracks the market narrative, per account (its voice) and channel, spread over the next 24 hours.",
  sources: [claudeDrafts],
  subjects: pickDraftSubjects,
  promote: promoteDrafts,
};

/**
 * Every fresh news catalyst that CONTRADICTS the market narrative (gold.catalysts, judged once by the catalysts dimension) and was not
 * drafted yet x every account of every channel (one unassigned draft when a channel has no account yet).
 */
export async function pickDraftSubjects(db: Db, ctx: SourceContext): Promise<string[]> {
  prepared.clear();
  const since = new Date(Date.now() - FRESH_HOURS * 3600_000);
  const catalysts = await db
    .select()
    .from(goldCatalysts)
    .where(and(eq(goldCatalysts.kind, "news"), eq(goldCatalysts.direction, "contradicts"), gte(goldCatalysts.eventAt, since)))
    .orderBy(desc(goldCatalysts.probability));
  const drafted = new Set(
    (await db.selectDistinct({ key: sql<string>`${content.contentDrafts.inputKey} || '|' || coalesce(${content.contentDrafts.accountId}, '') || '|' || ${content.contentDrafts.format}` }).from(content.contentDrafts)).map(
      (r) => r.key,
    ),
  );
  if (catalysts.length === 0) return [];
  if (!ctx.complete) throw new Error("no LLM in the collector context");

  const symbols = [...new Set(catalysts.map((c) => c.symbol))];
  const theses = await thesesBySymbol(db, symbols);
  const names = new Map(
    (await db.select({ symbol: gold.companyProfiles.symbol, name: gold.companyProfiles.name }).from(gold.companyProfiles).where(inArray(gold.companyProfiles.symbol, symbols))).map((r) => [r.symbol, r.name]),
  );
  const newsIds = catalysts.flatMap((c) => c.newsItemIds.slice(0, 1));
  const news = new Map(
    (newsIds.length ? await db.select().from(goldNewsItems).where(inArray(goldNewsItems.id, newsIds)) : []).map((n) => [n.id, n]),
  );
  const accounts = await activeAccounts(db);
  const voices = await voiceGuides(db);
  const chartsBySymbol = new Map<string, ChartOption[]>();

  const out: string[] = [];
  for (const c of catalysts) {
    const t = theses.get(c.symbol);
    if (!t) continue; // no thesis, no draft
    const n = c.newsItemIds[0] ? news.get(c.newsItemIds[0]) : undefined;
    const inputs: DraftInputs = {
      symbol: c.symbol,
      companyName: names.get(c.symbol) ?? null,
      news: n
        ? { id: n.id, title: n.title, url: n.url, publisher: n.publisher, publishedAt: (n.publishedAt ?? n.firstSeenAt).toISOString() }
        : { id: c.id, title: c.headline, url: c.url ?? "", publisher: c.publisher, publishedAt: c.eventAt.toISOString() },
      worthJudgmentId: null,
      worth: { probability: c.probability, citedSentence: c.evidence },
      catalyst: { id: c.id, direction: c.direction, probability: c.probability, reason: c.reason },
      thesis: t.thesis,
      driver: null,
      chart: null,
    };
    for (const [channel, formats] of Object.entries(FORMATS_BY_CHANNEL)) {
      const forChannel = accounts.filter((a) => a.channel === channel);
      const targets: ({ id: string; name: string } | null)[] = forChannel.length ? forChannel.map((a) => ({ id: a.id, name: a.name })) : [null];
      for (const account of targets) {
        for (const format of formats) {
          const key = `${c.id}|${account?.id ?? ""}|${format}`;
          if (drafted.has(key)) continue;
          let exhibits: ChartOption[] = [];
          if (format === "substack-article") {
            if (!chartsBySymbol.has(c.symbol)) chartsBySymbol.set(c.symbol, await chartOptions(db, c.symbol, inputs.companyName));
            exhibits = chartsBySymbol.get(c.symbol)!;
          }
          prepared.set(key, { inputs, narrative: t.narrative, newsSummary: n?.summary ?? null, format, account, voiceGuide: account ? (voices.get(account.id) ?? null) : null, exhibits });
          out.push(key);
        }
      }
    }
  }
  return out;
}

/** The thesis as the thesis dimension serves it (gold.theses: active text, Thierry's word winning) + the market's narrative. */
async function thesesBySymbol(db: Db, symbols: string[]) {
  const theses = await db
    .select({ symbol: goldTheses.symbol, summary: goldTheses.summary, state: goldTheses.summaryState, narrative: goldTheses.narrative })
    .from(goldTheses)
    .where(and(inArray(goldTheses.symbol, symbols), sql`coalesce(${goldTheses.summary}, '') <> ''`));
  const out = new Map<string, { thesis: { id: string; author: string; summary: string }; narrative: string | null }>();
  for (const t of theses) {
    // summary_state says whose words these are: draft (Claude), accepted / edited / thierry (Thierry's call).
    out.set(t.symbol, { thesis: { id: t.symbol, author: t.state ?? "draft", summary: t.summary! }, narrative: t.narrative });
  }
  return out;
}

/**
 * Spreads the publishing slots of the catalysts drafted in one run over the next 24 hours: the strongest first,
 * evenly spaced, every channel of one catalyst at the same slot.
 */
export function slotsFor(catalystIds: string[], start: Date, windowHours = SLOT_WINDOW_HOURS): Map<string, Date> {
  const step = (windowHours * 3600_000) / Math.max(catalystIds.length, 1);
  return new Map(catalystIds.map((id, i) => [id, new Date(start.getTime() + Math.round((i + 0.5) * step))]));
}

/**
 * Bronze generation -> silver.content_drafts (one row per generation, stored once: re-promoting the same bronze row
 * changes nothing) -> gold.content_drafts (latest version per catalyst x account x format).
 */
export async function promoteDrafts(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const ok = rows.filter((r) => !r.error && r.source === CLAUDE_SOURCE);
  // Slots: this run's catalysts in order of strength (the order subjects were picked in).
  const order: string[] = [];
  for (const f of ok) {
    const id = (f.request as { inputs: DraftInputs }).inputs.catalyst?.id ?? (f.request as { inputs: DraftInputs }).inputs.news?.id ?? f.id;
    if (!order.includes(id)) order.push(id);
  }
  const runStart = ok.length ? new Date(Math.min(...ok.map((f) => f.fetchedAt.getTime()))) : new Date();
  const slots = slotsFor(order, runStart);

  for (const f of ok) {
    const req = f.request as { inputs: DraftInputs; model: string; format: DraftFormat; accountId: string | null; exhibits: ChartOption[] };
    const format = req.format;
    const offered = req.exhibits ?? [];
    const generated = parseGeneration(format, f.payloadText ?? "", offered.map((x) => x.id));
    const charts: DraftChart[] | null = format === "substack-article" ? generated.exhibitIds.map((id) => offered.find((x) => x.id === id)!.chart) : null;
    const inputKey = req.inputs.catalyst?.id ?? req.inputs.news?.id ?? "thesis";
    const [{ prior }] = await db
      .select({ prior: sql<number>`count(distinct ${content.contentDrafts.generationBronzeId})::int` })
      .from(content.contentDrafts)
      .where(
        and(
          eq(content.contentDrafts.inputKey, inputKey),
          eq(content.contentDrafts.format, format),
          req.accountId ? eq(content.contentDrafts.accountId, req.accountId) : sql`${content.contentDrafts.accountId} is null`,
          sql`${content.contentDrafts.generationBronzeId} <> ${f.id}`,
        ),
      );
    const inserted = await db
      .insert(content.contentDrafts)
      .values({
        generationBronzeId: f.id,
        symbol: req.inputs.symbol,
        inputKey,
        format,
        accountId: req.accountId,
        version: prior + 1,
        title: generated.title,
        body: generated.body,
        inputs: req.inputs,
        charts,
        scheduledAt: slots.get(inputKey) ?? null,
        model: req.model,
        sources: [CLAUDE_SOURCE],
        bronzeIds: [f.id],
      })
      .onConflictDoNothing()
      .returning({ id: content.contentDrafts.id });
    n += inserted.length;
  }
  await rebuildGoldDrafts(db);
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

/** gold.content_drafts = the latest version per (input, account, format), published text with the disclaimer. */
export async function rebuildGoldDrafts(db: Db) {
  const all = await db.select().from(content.contentDrafts).orderBy(desc(content.contentDrafts.version));
  const accountNames = new Map((await db.select({ id: content.contentAccounts.id, name: content.contentAccounts.name }).from(content.contentAccounts)).map((a) => [a.id, a.name]));
  const latest = new Map<string, (typeof all)[number]>();
  for (const d of all) {
    const key = `${d.symbol}\u0000${d.inputKey}\u0000${d.accountId ?? ""}\u0000${d.format}`;
    if (!latest.has(key)) latest.set(key, d);
  }
  await db.transaction(async (tx) => {
    await tx.delete(content.goldContentDrafts);
    if (latest.size === 0) return;
    await tx.insert(content.goldContentDrafts).values([...latest.values()].map((d) => toGoldDraft(d, accountNames)));
  });
}

export function toGoldDraft(d: content.SilverContentDraft, accountNames: Map<string, string>): typeof content.goldContentDrafts.$inferInsert {
  return {
    id: d.id,
    symbol: d.symbol,
    inputKey: d.inputKey,
    format: d.format,
    accountId: d.accountId,
    accountName: d.accountId ? (accountNames.get(d.accountId) ?? d.accountId) : null,
    version: d.version,
    title: d.title,
    body: withDisclaimer(d.format, d.body),
    inputs: d.inputs,
    charts: d.charts,
    scheduledAt: d.scheduledAt,
    status: d.status,
    statusAt: d.statusAt,
    postedUrl: d.postedUrl,
    model: d.model,
    createdAt: d.createdAt,
  };
}
