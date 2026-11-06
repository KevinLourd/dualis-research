import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import { goldWhatsappConversation } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { setDraftStatus } from "@/content/manual";
import { clientPhone, draftMessage, publishMessage } from "@/content/messages";
import { judge } from "@/llm/judge";
import { enqueue } from "@/whatsapp/outbox";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { voiceGuides } from "../content-voices";
import { type DraftFormat, draftSystem, parseGeneration } from "../content-drafts/format";
import { rebuildGoldDrafts } from "../content-drafts";

export const REPLIES_DIMENSION = "content-replies";
export const CLAUDE_SOURCE = "claude";
export const WHATSAPP_SOURCE = "whatsapp";
const INTENT_QUESTION_KEY = "draft-reply@v1";
const INTENTS = ["approve", "change", "dismiss", "other"] as const;
type Intent = (typeof INTENTS)[number];
/** A message that quotes no draft still answers the last draft sent to him within this window. */
const CONTEXT_HOURS = 3;

type Prepared = {
  waMessageId: string;
  feedback: string;
  draft: content.SilverContentDraft | null;
  intent: Intent | "no-draft";
  judgmentId: string | null;
  voiceGuide: string | null;
  accountName: string | null;
};
const prepared = new Map<string, Prepared>();

export const REVISION_RULES = [
  "Revision: rewrite the draft below following Thierry's feedback. He is the author: his feedback wins over the style guide.",
  "Keep every sourced fact unless he asks to drop it; never add a figure that is not in the draft or his feedback.",
  "Keep the same format and its length rules. For an article keep the [EXHIBIT n] markers on their own lines.",
].join("\n");

/** Rewrites a draft after Thierry asked for a change; approve / dismiss need no LLM call, their decision still lands in bronze. */
export const replyWriter: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject, ctx) {
    const p = prepared.get(subject);
    if (!p) throw new Error(`no prepared reply for ${subject}`);
    const request = { waMessageId: p.waMessageId, intent: p.intent, judgmentId: p.judgmentId, draftId: p.draft?.id ?? null, feedback: p.feedback };
    if (p.intent !== "change" || !p.draft) return { request, httpStatus: null, payload: { intent: p.intent } };
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    const format = p.draft.format as DraftFormat;
    const system = `${draftSystem(format, p.voiceGuide, p.accountName)}\n\n${REVISION_RULES}`;
    const current = format === "substack-article" ? JSON.stringify({ title: p.draft.title, body: p.draft.body }) : p.draft.body;
    const prompt = `Current draft:\n${current}\n\nThierry's feedback:\n${p.feedback}`;
    const { text, model } = await ctx.complete({ system, prompt });
    const offered = (p.draft.charts ?? []).map((_, i) => String(i + 1));
    try {
      parseGeneration(format, articleAnswer(format, text), offered);
    } catch (err) {
      return { request: { ...request, model }, httpStatus: null, payloadText: text, error: `answer is not the expected ${format}: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { request: { ...request, model }, httpStatus: null, payloadText: text };
  },
};

/** An article rewrite may come back without its subtitle wrapper: the parser expects title + subtitle + body. */
function articleAnswer(format: DraftFormat, text: string): string {
  if (format !== "substack-article") return text;
  try {
    const obj = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { title?: string; subtitle?: string; body?: string };
    if (obj.subtitle || !obj.body) return text;
    const m = obj.body.match(/^\*([^*\n]+)\*\n+/);
    return JSON.stringify({ title: obj.title, subtitle: m ? m[1] : obj.title, body: m ? obj.body.slice(m[0].length) : obj.body });
  } catch {
    return text;
  }
}

export const contentReplies: Dimension = {
  name: REPLIES_DIMENSION,
  description: "Thierry's WhatsApp answers to drafts: OK posts it (one-click link), feedback rewrites it, no drops it. Each message handled once.",
  sources: [replyWriter],
  subjects: pickReplies,
  promote: promoteReplies,
};

/** Inbound messages from Thierry with a text (or transcript) not handled yet, each tied to the draft it answers. */
export async function pickReplies(db: Db, ctx: SourceContext): Promise<string[]> {
  prepared.clear();
  const phone = clientPhone();
  const handled = new Set((await db.select({ id: content.contentReplies.waMessageId }).from(content.contentReplies)).map((r) => r.id));
  const inbound = await db
    .select()
    .from(goldWhatsappConversation)
    .where(and(eq(goldWhatsappConversation.contact, phone), eq(goldWhatsappConversation.direction, "in"), isNotNull(goldWhatsappConversation.body)))
    .orderBy(goldWhatsappConversation.sentAt);
  const todo = inbound.filter((m) => !handled.has(m.waMessageId) && m.body!.trim());
  if (todo.length === 0) return [];

  const messages = await db.select().from(content.contentMessages).where(inArray(content.contentMessages.purpose, ["draft", "version"]));
  const byOutbox = new Map(messages.map((m) => [m.outboxId, m]));
  const outbound = await db.select().from(goldWhatsappConversation).where(and(eq(goldWhatsappConversation.contact, phone), eq(goldWhatsappConversation.direction, "out")));
  const outByWaId = new Map(outbound.map((o) => [o.waMessageId, o]));
  const voices = await voiceGuides(db);
  const accountNames = new Map((await db.select({ id: content.contentAccounts.id, name: content.contentAccounts.name }).from(content.contentAccounts)).map((a) => [a.id, a.name]));

  const out: string[] = [];
  for (const m of todo) {
    // The draft it answers: the message it quotes, else the last draft sent to him in the last hours.
    let draftId: string | null = null;
    const quoted = m.replyToWaId ? outByWaId.get(m.replyToWaId) : undefined;
    if (quoted?.outboxId) draftId = byOutbox.get(quoted.outboxId)?.draftId ?? null;
    if (!draftId && !m.replyToWaId) {
      const recent = outbound
        .filter((o) => o.outboxId && byOutbox.has(o.outboxId) && o.sentAt <= m.sentAt && o.sentAt.getTime() >= m.sentAt.getTime() - CONTEXT_HOURS * 3600_000)
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
      draftId = recent ? (byOutbox.get(recent.outboxId!)?.draftId ?? null) : null;
    }
    const draft = draftId ? await latestVersion(db, draftId) : null;
    let intent: Intent | "no-draft" = "no-draft";
    let judgmentId: string | null = null;
    if (draft) {
      if (!ctx.complete) throw new Error("no LLM in the collector context");
      const verdict = await judge(
        db,
        {
          subjectKind: "whatsapp-message",
          subjectId: m.waMessageId,
          questionKey: INTENT_QUESTION_KEY,
          question:
            "Thierry, the author, answered this draft post on WhatsApp. What does he want? approve = post it as is (OK, go, yes, looks good); change = he asks for any edit; dismiss = drop it, do not post; other = not about this draft.",
          input: [`Draft (${draft.format}):`, draft.title ?? "", draft.body, "", `Thierry: ${m.body}`].join("\n"),
          choices: INTENTS,
        },
        ctx.complete,
      );
      intent = verdict.verdict as Intent;
      judgmentId = verdict.id;
    }
    const key = `message:${m.waMessageId}`;
    prepared.set(key, { waMessageId: m.waMessageId, feedback: m.body!, draft, intent, judgmentId, voiceGuide: draft?.accountId ? (voices.get(draft.accountId) ?? null) : null, accountName: draft?.accountId ? (accountNames.get(draft.accountId) ?? null) : null });
    out.push(key);
  }
  return out;
}

/** The newest silver version of the draft a message points at (same input, account and format). */
async function latestVersion(db: Db, draftId: string) {
  const [d] = await db.select().from(content.contentDrafts).where(eq(content.contentDrafts.id, draftId));
  if (!d) return null;
  const [latest] = await db
    .select()
    .from(content.contentDrafts)
    .where(
      and(
        eq(content.contentDrafts.inputKey, d.inputKey),
        eq(content.contentDrafts.format, d.format),
        d.accountId ? eq(content.contentDrafts.accountId, d.accountId) : sql`${content.contentDrafts.accountId} is null`,
      ),
    )
    .orderBy(desc(content.contentDrafts.version))
    .limit(1);
  return latest ?? d;
}

/** One decision per inbound message: a new version + its message, the publish link, or an ack. Never twice. */
export async function promoteReplies(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const phone = clientPhone();
  for (const f of rows.filter((r) => r.source === CLAUDE_SOURCE)) {
    const req = f.request as { waMessageId: string; intent: Intent | "no-draft"; judgmentId: string | null; draftId: string | null };
    const [seen] = await db.select().from(content.contentReplies).where(eq(content.contentReplies.waMessageId, req.waMessageId));
    if (seen) continue;
    // A failed rewrite is answered next run (the message stays unhandled).
    if (f.error) continue;
    let newDraftId: string | null = null;
    let outboxId: string | null = null;
    const draft = req.draftId ? (await db.select().from(content.contentDrafts).where(eq(content.contentDrafts.id, req.draftId)))[0] : undefined;

    if (draft && req.intent === "change") {
      const format = draft.format as DraftFormat;
      const offered = (draft.charts ?? []).map((_, i) => String(i + 1));
      const g = parseGeneration(format, articleAnswer(format, f.payloadText ?? ""), offered);
      const charts = draft.charts ? g.exhibitIds.map((i) => draft.charts![Number(i) - 1]) : null;
      const [row] = await db
        .insert(content.contentDrafts)
        .values({
          generationBronzeId: f.id,
          symbol: draft.symbol,
          inputKey: draft.inputKey,
          ideaId: draft.ideaId,
          format: draft.format,
          accountId: draft.accountId,
          version: draft.version + 1,
          title: g.title ?? draft.title,
          body: g.body,
          inputs: draft.inputs,
          charts,
          scheduledAt: draft.scheduledAt,
          model: (f.request as { model?: string }).model ?? draft.model,
          sources: [CLAUDE_SOURCE, WHATSAPP_SOURCE],
          bronzeIds: [f.id, f.id],
        })
        .onConflictDoNothing()
        .returning();
      await rebuildGoldDrafts(db);
      if (row) {
        newDraftId = row.id;
        const [g2] = await db.select().from(content.goldContentDrafts).where(eq(content.goldContentDrafts.id, row.id));
        if (!g2) throw new Error(`new version ${row.id} missing from gold`);
        outboxId = (await enqueue(db, { recipient: phone, text: draftMessage(g2, true), replyToWaId: req.waMessageId, requestedBy: REPLIES_DIMENSION })).id;
        await db.insert(content.contentMessages).values({ outboxId, bronzeId: f.id, purpose: "version", draftId: row.id, recipient: phone, scheduledAt: new Date(), sources: [CLAUDE_SOURCE] });
      }
    } else if (draft && (req.intent === "approve" || req.intent === "dismiss")) {
      await setDraftStatus(db, draft.id, req.intent === "approve" ? "approved" : "dismissed", { userId: null, source: WHATSAPP_SOURCE });
      const [g] = await db.select().from(content.goldContentDrafts).where(eq(content.goldContentDrafts.id, draft.id));
      const text = req.intent === "approve" ? publishMessage(g) : "Dropped, it will not be posted.";
      outboxId = (await enqueue(db, { recipient: phone, text, replyToWaId: req.waMessageId, requestedBy: REPLIES_DIMENSION })).id;
      await db.insert(content.contentMessages).values({ outboxId, bronzeId: f.id, purpose: req.intent === "approve" ? "publish" : "ack", draftId: draft.id, recipient: phone, scheduledAt: new Date(), sources: [WHATSAPP_SOURCE] });
    }

    await db
      .insert(content.contentReplies)
      .values({ waMessageId: req.waMessageId, draftId: draft?.id ?? null, intent: req.intent, judgmentId: req.judgmentId, newDraftId, outboxId, sources: [WHATSAPP_SOURCE], bronzeIds: [f.id] })
      .onConflictDoNothing();
    n += 1;
  }
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

