import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { thesisTransitions } from "@/db/schema/catalysts";
import { tickers } from "@/db/schema/gold";
import * as content from "@/db/schema/content";
import { whatsappLink } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { alertMessage, clientPhone, draftMessage, postLoopPhone } from "@/content/messages";
import { postImage } from "@/content/post-image";
import { enqueue } from "@/whatsapp/outbox";
import type { Dimension, PromoteResult, Source } from "../../types";

export const DISPATCH_DIMENSION = "content-dispatch";
export const PLAN_SOURCE = "content";
/** Drafts are queued this far ahead of their slot, so the WhatsApp service (idle tick: 30 min) sends them on time. */
const AHEAD_MIN = 35;
/** A slot missed by more than this (device not linked, service down) is skipped, never sent late in a burst. */
const LATE_MIN = 120;
/** First run: transitions older than this are the baseline, recorded as known without a message. */
const BASELINE_HOURS = 24;
/** A draft waits this long for its card (content-visuals runs right after the writer), then goes without an image. */
const IMAGE_WAIT_MIN = 60;

type Planned = { purpose: "draft" | "alert" | "baseline"; recipient: string; text: string; scheduledAt: string; draftId: string | null; transitionId: string | null; visualId?: string | null };
const planned = new Map<string, Planned>();

/** Builds the message; no external call. The decision lands in bronze like any fetch. */
export const dispatchPlan: Source = {
  name: PLAN_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject) {
    const p = planned.get(subject);
    if (!p) throw new Error(`no planned message for ${subject}`);
    return { request: { subject }, httpStatus: null, payload: p };
  },
};

export const contentDispatch: Dimension = {
  name: DISPATCH_DIMENSION,
  description: "WhatsApp: each draft at its slot with its card (Kevin while we test), and every change of confidence in a thesis (Thierry).",
  sources: [dispatchPlan],
  subjects: planDispatch,
  promote: promoteDispatch,
};

async function linked(db: Db): Promise<boolean> {
  const [l] = await db.select({ status: whatsappLink.status }).from(whatsappLink).where(eq(whatsappLink.id, "default"));
  return l?.status === "linked";
}

export async function planDispatch(db: Db): Promise<string[]> {
  planned.clear();
  // Unlinked: nothing is queued (a queue would flush stale slots in a burst once linked).
  if (!(await linked(db))) return [];
  const recipient = clientPhone();
  const postRecipient = postLoopPhone();
  const now = Date.now();
  const sent = await db.select({ draftId: content.contentMessages.draftId, transitionId: content.contentMessages.transitionId, purpose: content.contentMessages.purpose }).from(content.contentMessages);
  const sentDrafts = new Set(sent.filter((s) => s.purpose === "draft").map((s) => s.draftId));
  const knownTransitions = new Set(sent.map((s) => s.transitionId).filter(Boolean));
  const out: string[] = [];

  const due = await db
    .select()
    .from(content.goldContentDrafts)
    .where(
      and(
        isNotNull(content.goldContentDrafts.scheduledAt),
        eq(content.goldContentDrafts.status, "draft"),
        lte(content.goldContentDrafts.scheduledAt, new Date(now + AHEAD_MIN * 60_000)),
        gte(content.goldContentDrafts.scheduledAt, new Date(now - LATE_MIN * 60_000)),
      ),
    );
  for (const d of due.filter((d) => !sentDrafts.has(d.id)).sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())) {
    const image = await postImage(db, d.ideaId);
    if (image.state === "waiting" && d.createdAt.getTime() > now - IMAGE_WAIT_MIN * 60_000) continue;
    const key = `draft:${d.id}`;
    planned.set(key, {
      purpose: "draft",
      recipient: postRecipient,
      text: draftMessage(d),
      scheduledAt: new Date(Math.max(d.scheduledAt!.getTime(), now)).toISOString(),
      draftId: d.id,
      transitionId: null,
      visualId: image.state === "ready" ? image.visualId : null,
    });
    out.push(key);
  }

  const firstRun = !sent.some((s) => s.purpose === "alert" || s.purpose === "baseline");
  const transitions = await db.select().from(thesisTransitions);
  const positionOf = new Map((await db.select({ symbol: tickers.symbol, position: tickers.position }).from(tickers)).map((r) => [r.symbol, r.position]));
  for (const t of transitions.filter((t) => !knownTransitions.has(t.id)).sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = `transition:${t.id}`;
    const old = firstRun && t.at.getTime() < now - BASELINE_HOURS * 3600_000;
    planned.set(key, { purpose: old ? "baseline" : "alert", recipient, text: alertMessage(t, positionOf.get(t.symbol) ?? null), scheduledAt: new Date(now).toISOString(), draftId: null, transitionId: t.id });
    out.push(key);
  }
  return out;
}

/** Each planned message -> app.whatsapp_outbox (except baselines) + silver.content_messages, once per bronze row. */
export async function promoteDispatch(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const ok = rows.filter((r) => !r.error && r.source === PLAN_SOURCE);
  const done = new Set(
    ok.length
      ? (await db.select({ b: content.contentMessages.bronzeId }).from(content.contentMessages).where(inArray(content.contentMessages.bronzeId, ok.map((r) => r.id)))).map((r) => r.b)
      : [],
  );
  for (const f of ok.filter((r) => !done.has(r.id))) {
    const p = f.payload as Planned;
    const outboxId =
      p.purpose === "baseline"
        ? crypto.randomUUID()
        : (await enqueue(db, { recipient: p.recipient, text: p.text, ...(await visualFile(db, p.visualId)), scheduledAt: new Date(p.scheduledAt), requestedBy: DISPATCH_DIMENSION })).id;
    await db.insert(content.contentMessages).values({
      outboxId,
      bronzeId: f.id,
      purpose: p.purpose,
      draftId: p.draftId,
      transitionId: p.transitionId,
      recipient: p.recipient,
      scheduledAt: new Date(p.scheduledAt),
      sources: [PLAN_SOURCE],
    });
    n += 1;
  }
  return { silverRowsBySource: { [PLAN_SOURCE]: n } };
}

/** The card's bytes for the outbox (bronze keeps only its id). */
async function visualFile(db: Db, visualId: string | null | undefined): Promise<{ image?: Buffer; imageMime?: string }> {
  if (!visualId) return {};
  const [v] = await db.select({ file: content.contentVisuals.file, mime: content.contentVisuals.mime }).from(content.contentVisuals).where(eq(content.contentVisuals.id, visualId));
  if (!v?.file || !v.mime) throw new Error(`visual ${visualId} has no file`);
  return { image: Buffer.from(v.file), imageMime: v.mime };
}
