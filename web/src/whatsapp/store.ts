import { eq, inArray } from "drizzle-orm";
import { type BronzeFetch, fetches } from "../db/schema/bronze";
import { runSources, runs } from "../db/schema/ops";
import { type DeliveryState, deliveryStates, goldWhatsappConversation, type MessageDirection, whatsappMessages } from "../db/schema/whatsapp";
import type { Db } from "../db/types";
import { allowlist } from "./allowlist";
import { parseMessage } from "./parse";

export const DIMENSION = "whatsapp";
export const SOURCE_WHATSAPP = "whatsapp";
export const SOURCE_WHISPER = "whisper";

/** One raw fact the service saw, before it lands in bronze. Subjects: message:, receipt:, media:, transcript:, send:. */
export type BronzeEntry = {
  source: typeof SOURCE_WHATSAPP | typeof SOURCE_WHISPER;
  subject: string;
  request: Record<string, unknown>;
  payload?: unknown;
  payloadText?: string | null;
  error?: string | null;
};

/** Request of a `message:` / `send:` entry: who the other side is and which way it went. */
export type MessageRequest = { contact: string; direction: MessageDirection; outboxId?: string | null };

/**
 * Writes entries to bronze under one ops run (dimension "whatsapp", trigger "service"), with per-source tallies so
 * the Data page shows the service like any collector, then promotes them to silver + gold. Returns the bronze rows.
 */
export async function ingest(db: Db, entries: BronzeEntry[]): Promise<BronzeFetch[]> {
  if (entries.length === 0) return [];
  const failed = entries.some((e) => e.error);
  const [run] = await db
    .insert(runs)
    .values({ dimension: DIMENSION, trigger: "service", status: failed ? "partial" : "succeeded", finishedAt: new Date() })
    .returning({ id: runs.id });
  const rows = await db
    .insert(fetches)
    .values(
      entries.map((e) => ({
        runId: run.id,
        dimension: DIMENSION,
        source: e.source,
        subject: e.subject,
        request: e.request,
        httpStatus: null,
        payload: e.payload ?? null,
        payloadText: e.payloadText ?? null,
        error: e.error ?? null,
      })),
    )
    .returning();
  const touched = await promote(db, rows);
  const bySource = new Map<string, BronzeFetch[]>();
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  await db.insert(runSources).values(
    [...bySource].map(([source, rs]) => {
      const bad = rs.filter((r) => r.error);
      return {
        runId: run.id,
        source,
        status: bad.length === 0 ? ("ok" as const) : bad.length === rs.length ? ("failed" as const) : ("partial" as const),
        requested: rs.length,
        succeeded: rs.length - bad.length,
        failed: bad.length,
        bronzeRows: rs.length,
        silverRows: touched.size,
        errors: bad.slice(0, 20).map((r) => ({ subject: r.subject, message: r.error ?? "" })),
      };
    }),
  );
  return rows;
}

function subjectId(subject: string): [string, string] {
  const i = subject.indexOf(":");
  return [subject.slice(0, i), subject.slice(i + 1)];
}

const rank = (d: DeliveryState | null) => (d ? deliveryStates.indexOf(d) : -1);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * Bronze -> silver: one silver row per WhatsApp message id whatever how many times it was seen (live event, send
 * result, history), every source tag kept; receipts only move delivery forward; media and transcript attach to
 * their message. Then rebuilds gold for the touched messages. Returns the touched WhatsApp ids.
 */
export async function promote(db: Db, rows: BronzeFetch[]): Promise<Set<string>> {
  const touched = new Set<string>();
  const ordered = [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  for (const row of ordered) {
    if (row.dimension !== DIMENSION || row.error) continue;
    const [kind, id] = subjectId(row.subject);
    if (kind === "message" || kind === "send") {
      const payload = row.payload as { message?: unknown } | null;
      const raw = kind === "send" ? payload?.message : row.payload;
      if (!raw) continue;
      const req = row.request as MessageRequest;
      const p = parseMessage(raw);
      const outboxId = kind === "send" ? id : (req.outboxId ?? null);
      const [existing] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.waMessageId, p.waMessageId));
      if (existing) {
        await db
          .update(whatsappMessages)
          .set({
            outboxId: existing.outboxId ?? outboxId,
            sources: union(existing.sources, [row.source]),
            bronzeIds: union(existing.bronzeIds, [row.id]),
            lastSeenAt: new Date(),
          })
          .where(eq(whatsappMessages.id, existing.id));
      } else {
        await db.insert(whatsappMessages).values({
          waMessageId: p.waMessageId,
          contact: req.contact,
          direction: req.direction,
          kind: p.kind,
          text: p.text,
          mediaMime: p.mediaMime,
          replyToWaId: p.replyToWaId,
          outboxId,
          delivery: req.direction === "out" ? "sent" : null,
          sentAt: p.sentAt,
          sources: [row.source],
          bronzeIds: [row.id],
        });
      }
      touched.add(p.waMessageId);
      continue;
    }
    const [msg] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.waMessageId, id));
    if (!msg) continue; // a receipt/media/transcript for a message we never stored (not allowlisted): bronze keeps it
    const set: Partial<typeof whatsappMessages.$inferInsert> = {
      sources: union(msg.sources, [row.source]),
      bronzeIds: union(msg.bronzeIds, [row.id]),
      lastSeenAt: new Date(),
    };
    if (kind === "receipt") {
      const status = (row.payload as { status: DeliveryState }).status;
      if (rank(status) <= rank(msg.delivery)) continue;
      set.delivery = status;
    } else if (kind === "media") {
      set.mediaBronzeId = row.id;
    } else if (kind === "transcript") {
      const t = row.payload as { text: string; model: string };
      set.transcript = t.text.trim() || null;
      set.transcriptModel = t.model;
    } else continue;
    await db.update(whatsappMessages).set(set).where(eq(whatsappMessages.id, msg.id));
    touched.add(id);
  }
  await rebuildGold(db, [...touched]);
  return touched;
}

/** Rebuilds gold rows for these WhatsApp ids from silver. */
export async function rebuildGold(db: Db, waIds: string[]) {
  if (waIds.length === 0) return;
  const rows = await db.select().from(whatsappMessages).where(inArray(whatsappMessages.waMessageId, waIds));
  await db.delete(goldWhatsappConversation).where(inArray(goldWhatsappConversation.waMessageId, waIds));
  await db.insert(goldWhatsappConversation).values(
    rows.map((m) => ({
      id: m.id,
      waMessageId: m.waMessageId,
      contact: m.contact,
      contactName: allowlist().find((c) => c.phone === m.contact)?.name ?? m.contact,
      direction: m.direction,
      kind: m.kind,
      body: m.kind === "voice" || m.kind === "audio" ? (m.transcript ?? m.text) : m.text,
      text: m.text,
      transcript: m.transcript,
      mediaMime: m.mediaMime,
      replyToWaId: m.replyToWaId,
      outboxId: m.outboxId,
      delivery: m.delivery,
      sentAt: m.sentAt,
      sources: m.sources,
    })),
  );
}
