import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { evidence, narrativeDrivers, narratives, signalChanges, signals } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { DraftChart, DraftInputs } from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { refreshGoldIdea, utcDay } from "@/content/ideas";
import type { Dimension, PromoteResult, Source } from "../../types";
import { activeAccounts } from "../content-accounts";
import { voiceGuides } from "../content-voices";
import { chartOptions, type ChartOption } from "./charts";
import { DRAFT_FORMATS, type DraftFormat, draftPrompt, draftSystem, type IdeaContext, parseGeneration, PROMPT_VERSION, withDisclaimer } from "./format";

export const DRAFTS_DIMENSION = "content-drafts";
export const CLAUDE_SOURCE = "claude";

/** The channel a format is published on. */
export const CHANNEL_OF: Record<DraftFormat, "x" | "linkedin" | "substack"> = {
  "x-post": "x",
  "linkedin-post": "linkedin",
  "substack-note": "substack",
  "substack-article": "substack",
};
/** Whose voice a draft takes when a channel has several accounts: Thierry's own first. */
const OWNER_ORDER = ["thierry", "dualis", "duality"];

type DraftRequestFetch = {
  promptVersion: string;
  model: string;
  requestId: string;
  ideaId: string;
  format: DraftFormat;
  accountId: string | null;
  inputs: DraftInputs;
  exhibits: ChartOption[];
  prompt: string;
};

/** The account a format is written for, and its voice guide. */
async function accountFor(db: Db, format: DraftFormat) {
  const accounts = (await activeAccounts(db, CHANNEL_OF[format])).sort((a, b) => OWNER_ORDER.indexOf(a.owner) - OWNER_ORDER.indexOf(b.owner));
  const account = accounts[0] ?? null;
  return { account, voiceGuide: account ? ((await voiceGuides(db)).get(account.id) ?? null) : null };
}

/** The ticker's story and the evidence an Idea rests on, in words, read from gold at draft time. */
async function ideaContext(db: Db, idea: content.SilverContentIdea, symbol: string): Promise<IdeaContext> {
  const refs = (kind: string) => idea.sourceRefs.filter((r) => r.kind === kind).map((r) => r.ref.slice(kind.length + 1));
  const evidenceIds = refs("evidence");
  const driverIds = refs("driver");
  const changeIds = refs("change");
  const [[n], [s], ev, drv, ch] = await Promise.all([
    db.select().from(narratives).where(eq(narratives.symbol, symbol)),
    db.select().from(signals).where(eq(signals.symbol, symbol)),
    evidenceIds.length ? db.select().from(evidence).where(inArray(evidence.id, evidenceIds)) : [],
    db.select().from(narrativeDrivers).where(driverIds.length ? inArray(narrativeDrivers.id, driverIds) : eq(narrativeDrivers.symbol, symbol)),
    changeIds.length ? db.select().from(signalChanges).where(inArray(signalChanges.id, changeIds)) : [],
  ]);
  return {
    narrative: n?.detail ? `${n.text} ${n.detail}` : (n?.text ?? null),
    signal: s ? (s.signal === "none" ? "no signal" : `${s.signal}, ${s.strength}`) : null,
    fairValue:
      s && s.fairValue !== null
        ? `${s.fairValue} ${s.currency ?? ""}${s.fairValueLabel ? ` (${s.fairValueLabel})` : ""}; quote ${s.quote ?? "?"} on ${s.quoteDate ?? "?"}${s.gapPct !== null ? `, ${Math.round(s.gapPct * 100)}% vs fair value` : ""}`
        : null,
    evidence: ev.map((e) => ({ headline: e.headline, publisher: e.publisher, day: e.eventDay, why: e.why, url: e.url })),
    drivers: drv.map((d) => ({ title: d.title, summary: d.summary })),
    signalChanges: ch.map((c) => ({ label: `${c.fromSignal} ${c.fromStrength} to ${c.toSignal} ${c.toStrength} on ${utcDay(c.at)}`, note: c.updateNote })),
  };
}

/** One LLM call per draft request (an Idea x a format), in the voice of that channel's account. The raw answer lands in bronze. */
export const claudeDrafts: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  concurrency: 4,
  async fetch(subject, ctx) {
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    if (!ctx.db) throw new Error("no database in the collector context");
    const db = ctx.db;
    const requestId = subject.replace(/^request:/, "");
    const [req] = await db.select().from(content.contentDraftRequests).where(eq(content.contentDraftRequests.id, requestId));
    if (!req) throw new Error(`draft request ${requestId} not found`);
    const [idea] = await db.select().from(content.contentIdeas).where(eq(content.contentIdeas.id, req.ideaId));
    if (!idea) throw new Error(`idea ${req.ideaId} not found`);
    const format = req.format as DraftFormat;
    const symbol = idea.symbol ?? idea.sourceRefs.find((r) => r.symbol)?.symbol ?? "";
    const [profile] = symbol ? await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)) : [];
    const inputs: DraftInputs = {
      symbol,
      companyName: profile?.name ?? null,
      news: null,
      worthJudgmentId: null,
      worth: null,
      thesis: null,
      driver: null,
      chart: null,
      idea: { id: idea.id, title: idea.title, angle: idea.angle, sources: idea.sourceRefs },
    };
    const { account, voiceGuide } = await accountFor(db, format);
    const exhibits = format === "substack-article" && symbol ? await chartOptions(db, symbol, inputs.companyName) : [];
    const prompt = draftPrompt(inputs, await ideaContext(db, idea, symbol), exhibits.map((x) => ({ id: x.id, label: x.label })));
    const { text, model } = await ctx.complete({ system: draftSystem(format, voiceGuide, account?.name ?? null), prompt });
    const request: DraftRequestFetch = { promptVersion: PROMPT_VERSION, model, requestId, ideaId: idea.id, format, accountId: account?.id ?? null, inputs, exhibits, prompt };
    const outcome = { request, httpStatus: null, payloadText: text };
    try {
      parseGeneration(format, text, exhibits.map((x) => x.id));
    } catch (err) {
      return { ...outcome, error: `answer is not the expected ${format}: ${err instanceof Error ? err.message : String(err)}` };
    }
    return outcome;
  },
};

export const contentDrafts: Dimension = {
  name: DRAFTS_DIMENSION,
  description: "Drafts Thierry asked for from the Ideas table: one per Idea and channel x format, in that channel's account voice.",
  sources: [claudeDrafts],
  subjects: pickDraftSubjects,
  promote: promoteDrafts,
};

/** Every pending draft request, oldest first. */
export async function pickDraftSubjects(db: Db): Promise<string[]> {
  const pending = await db
    .select({ id: content.contentDraftRequests.id, format: content.contentDraftRequests.format })
    .from(content.contentDraftRequests)
    .where(eq(content.contentDraftRequests.status, "pending"))
    .orderBy(content.contentDraftRequests.requestedAt);
  return pending.filter((r) => (DRAFT_FORMATS as readonly string[]).includes(r.format)).map((r) => `request:${r.id}`);
}

/**
 * Bronze generation -> silver.content_drafts (stored once: re-promoting the same bronze row changes nothing), its
 * request marked done (or failed, with the reason) -> gold.content_drafts and the Idea's gold row.
 */
export async function promoteDrafts(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const touched = new Set<string>();
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE && r.subject.startsWith("request:"))) {
    const requestId = f.subject.slice("request:".length);
    if (f.error) {
      const [r] = await db
        .update(content.contentDraftRequests)
        .set({ status: "failed", error: f.error, finishedAt: new Date(), sources: sql`array_append(${content.contentDraftRequests.sources}, ${CLAUDE_SOURCE})`, bronzeIds: sql`array_append(${content.contentDraftRequests.bronzeIds}, ${f.id}::uuid)` })
        .where(and(eq(content.contentDraftRequests.id, requestId), eq(content.contentDraftRequests.status, "pending")))
        .returning({ ideaId: content.contentDraftRequests.ideaId });
      if (r) touched.add(r.ideaId);
      continue;
    }
    const req = f.request as DraftRequestFetch;
    const format = req.format;
    const offered = req.exhibits ?? [];
    const generated = parseGeneration(format, f.payloadText ?? "", offered.map((x) => x.id));
    const charts: DraftChart[] | null = format === "substack-article" ? generated.exhibitIds.map((id) => offered.find((x) => x.id === id)!.chart) : null;
    const inputKey = `idea:${req.ideaId}`;
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
    const [inserted] = await db
      .insert(content.contentDrafts)
      .values({
        generationBronzeId: f.id,
        symbol: req.inputs.symbol,
        inputKey,
        ideaId: req.ideaId,
        format,
        accountId: req.accountId,
        version: prior + 1,
        title: generated.title,
        body: generated.body,
        inputs: req.inputs,
        charts,
        scheduledAt: null,
        model: req.model,
        sources: [CLAUDE_SOURCE],
        bronzeIds: [f.id],
      })
      .onConflictDoNothing()
      .returning({ id: content.contentDrafts.id });
    const draftId =
      inserted?.id ??
      (await db.select({ id: content.contentDrafts.id }).from(content.contentDrafts).where(and(eq(content.contentDrafts.generationBronzeId, f.id), eq(content.contentDrafts.format, format))))[0]?.id;
    if (inserted) n += 1;
    await db
      .update(content.contentDraftRequests)
      .set({ status: "done", draftId, error: null, finishedAt: new Date(), sources: sql`array_append(${content.contentDraftRequests.sources}, ${CLAUDE_SOURCE})`, bronzeIds: sql`array_append(${content.contentDraftRequests.bronzeIds}, ${f.id}::uuid)` })
      .where(and(eq(content.contentDraftRequests.id, requestId), eq(content.contentDraftRequests.status, "pending")));
    touched.add(req.ideaId);
  }
  await rebuildGoldDrafts(db);
  for (const ideaId of touched) await refreshGoldIdea(db, ideaId);
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
    ideaId: d.ideaId,
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
