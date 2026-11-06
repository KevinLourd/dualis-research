import { and, desc, eq, inArray, min, sql } from "drizzle-orm";
import { fetches } from "../db/schema/bronze";
import { type OutboxRow, whatsappOutbox } from "../db/schema/whatsapp";
import type { Db } from "../db/types";
import { contactByPhone, normalizePhone, phoneJid } from "./allowlist";
import { DIMENSION, ingest, SOURCE_WHATSAPP } from "./store";

/** Every message Dualis sends opens with this line, so Thierry never mistakes it for the number's other assistant. */
export const SIGNATURE = "*Dualis Research*";
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 60_000;

export function signed(text: string | null): string {
  const body = text?.trim();
  return body ? `${SIGNATURE}\n${body}` : SIGNATURE;
}

export type OutgoingMessage = {
  text: string;
  image?: { url: string } | Buffer;
  imageMime?: string | null;
  /** The raw WhatsApp message to quote (from bronze), when replying. */
  quoted?: unknown;
};

/** What actually talks to WhatsApp. Returns the raw sent message (JSON-safe), whose key.id is the WhatsApp id. */
export type Sender = { send(jid: string, message: OutgoingMessage): Promise<{ key: { id?: string | null } } & Record<string, unknown>> };

/** Queues a message. Any dimension calls this (or INSERTs the same row). */
export async function enqueue(
  db: Db,
  row: { recipient: string; text?: string | null; imageUrl?: string | null; image?: Buffer | null; imageMime?: string | null; replyToWaId?: string | null; scheduledAt?: Date; requestedBy: string },
): Promise<OutboxRow> {
  const [out] = await db.insert(whatsappOutbox).values({ ...row, recipient: normalizePhone(row.recipient) }).returning();
  return out;
}

/** Due rows, marked "sending" in the same statement so two loops never send one row twice. */
export async function claimDue(db: Db, now: Date, limit = 5): Promise<OutboxRow[]> {
  const due = db
    .select({ id: whatsappOutbox.id })
    .from(whatsappOutbox)
    .where(and(eq(whatsappOutbox.status, "queued"), sql`${whatsappOutbox.scheduledAt} <= ${now.toISOString()}`))
    .orderBy(whatsappOutbox.scheduledAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(whatsappOutbox)
    .set({ status: "sending", attempts: sql`${whatsappOutbox.attempts} + 1` })
    .where(inArray(whatsappOutbox.id, due))
    .returning();
}

/** Earliest scheduled time among queued rows, so the loop can sleep until then. */
export async function nextDueAt(db: Db): Promise<Date | null> {
  const [r] = await db.select({ at: min(whatsappOutbox.scheduledAt) }).from(whatsappOutbox).where(eq(whatsappOutbox.status, "queued"));
  return r?.at ? new Date(r.at) : null;
}

/**
 * Rows left "sending" by a crash: WhatsApp may or may not have them, so they are failed rather than re-sent (a
 * double message to Thierry is worse than a missing one, which shows up as failed in the outbox).
 */
export async function failInterrupted(db: Db): Promise<number> {
  const rows = await db
    .update(whatsappOutbox)
    .set({ status: "failed", error: "service restarted during the send; not retried to avoid a double message" })
    .where(eq(whatsappOutbox.status, "sending"))
    .returning({ id: whatsappOutbox.id });
  return rows.length;
}

/** The raw message with this WhatsApp id, from bronze (live event or our own send result), to quote it. */
async function rawMessage(db: Db, waId: string): Promise<unknown | null> {
  const [m] = await db
    .select({ payload: fetches.payload })
    .from(fetches)
    .where(and(eq(fetches.dimension, DIMENSION), eq(fetches.subject, `message:${waId}`)))
    .orderBy(desc(fetches.fetchedAt))
    .limit(1);
  if (m?.payload) return m.payload;
  const [s] = await db
    .select({ payload: fetches.payload })
    .from(fetches)
    .where(and(eq(fetches.dimension, DIMENSION), sql`${fetches.subject} like 'send:%'`, sql`${fetches.payload}->>'waMessageId' = ${waId}`))
    .limit(1);
  return (s?.payload as { message?: unknown } | undefined)?.message ?? null;
}

/** Sends one claimed row (or refuses it) and records the result in bronze, silver, gold and the outbox row. */
export async function sendOne(db: Db, sender: Sender, row: OutboxRow): Promise<OutboxRow["status"]> {
  const request = { recipient: row.recipient, hasImage: Boolean(row.imageUrl || row.image), replyToWaId: row.replyToWaId, attempt: row.attempts };
  const contact = contactByPhone(row.recipient);
  if (!contact) {
    const error = `recipient ${row.recipient} is not on the WhatsApp allowlist; refused, nothing sent`;
    const [b] = await ingest(db, [{ source: SOURCE_WHATSAPP, subject: `send:${row.id}`, request, error }]);
    await db.update(whatsappOutbox).set({ status: "refused", error, resultBronzeId: b.id }).where(eq(whatsappOutbox.id, row.id));
    return "refused";
  }
  let sent: Awaited<ReturnType<Sender["send"]>>;
  try {
    const quoted = row.replyToWaId ? await rawMessage(db, row.replyToWaId) : undefined;
    const image = row.image ? row.image : row.imageUrl ? { url: row.imageUrl } : undefined;
    sent = await sender.send(phoneJid(contact.phone), { text: signed(row.text), image, imageMime: row.imageMime, quoted: quoted ?? undefined });
    if (!sent.key.id) throw new Error("WhatsApp returned no message id");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const [b] = await ingest(db, [{ source: SOURCE_WHATSAPP, subject: `send:${row.id}`, request, error }]);
    const final = row.attempts >= MAX_ATTEMPTS;
    await db
      .update(whatsappOutbox)
      .set({
        status: final ? "failed" : "queued",
        error,
        resultBronzeId: b.id,
        scheduledAt: final ? row.scheduledAt : new Date(Date.now() + RETRY_AFTER_MS),
      })
      .where(eq(whatsappOutbox.id, row.id));
    return final ? "failed" : "queued";
  }
  // Sent: from here a failure must NOT requeue (it would message the person twice); it throws and the row stays
  // "sending", failed on the next boot.
  const waMessageId = sent.key.id as string;
  const [b] = await ingest(db, [
    { source: SOURCE_WHATSAPP, subject: `send:${row.id}`, request: { ...request, contact: contact.phone, direction: "out" }, payload: { waMessageId, message: sent } },
  ]);
  await db
    .update(whatsappOutbox)
    .set({ status: "sent", waMessageId, error: null, resultBronzeId: b.id, sentAt: new Date() })
    .where(eq(whatsappOutbox.id, row.id));
  return "sent";
}

/** One pass: claim due rows, send each. Returns how many rows it handled. */
export async function processOutbox(db: Db, sender: Sender, now = new Date()): Promise<number> {
  const rows = await claimDue(db, now);
  for (const row of rows) await sendOne(db, sender, row);
  return rows.length;
}
