import { customType, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app } from "./app";
import { gold } from "./gold";
import { ops } from "./ops";
import { silver } from "./silver";

/**
 * WhatsApp dimension: Dualis's own linked device on an existing number (see `wa/README.md`).
 * - bronze.fetches, dimension "whatsapp": every raw message, receipt, media download (source "whatsapp"), every voice
 *   transcript (source "whisper") and every send result or refusal (source "whatsapp", subject "send:<outbox id>").
 * - silver.whatsapp_messages: one row per WhatsApp message id, both directions, allowlisted contacts only.
 * - gold.whatsapp_conversation: what the console (and any dimension) reads.
 * - app.whatsapp_outbox: the queue any dimension writes to; the service sends due rows and records the result.
 * Never read by Workers code except gold + ops.whatsapp_link (Settings).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const messageDirections = ["in", "out"] as const;
export type MessageDirection = (typeof messageDirections)[number];
export const messageKinds = ["text", "voice", "audio", "image", "video", "document", "sticker", "reaction", "other"] as const;
export type MessageKind = (typeof messageKinds)[number];
/** WhatsApp delivery ladder for outbound messages, in order. */
export const deliveryStates = ["pending", "sent", "delivered", "read", "played"] as const;
export type DeliveryState = (typeof deliveryStates)[number];

/** One row per WhatsApp message with an allowlisted contact. Natural key: the WhatsApp message id. */
export const whatsappMessages = silver.table(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waMessageId: text("wa_message_id").notNull(),
    /** The other side, phone digits with country code (e.g. "15550000001"). */
    contact: text("contact").notNull(),
    direction: text("direction").$type<MessageDirection>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull(),
    /** Text body or media caption. */
    text: text("text"),
    /** Voice note transcript (source "whisper"). */
    transcript: text("transcript"),
    transcriptModel: text("transcript_model"),
    mediaMime: text("media_mime"),
    /** Bronze row holding the media bytes (payload_text = base64). */
    mediaBronzeId: uuid("media_bronze_id"),
    /** WhatsApp id of the message this one quotes. */
    replyToWaId: text("reply_to_wa_id"),
    /** Outbox row that produced this message, for sends from Dualis. */
    outboxId: uuid("outbox_id"),
    delivery: text("delivery").$type<DeliveryState>(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_messages_wa_id").on(t.waMessageId), index("whatsapp_messages_contact_sent").on(t.contact, t.sentAt)],
);
export type SilverWhatsappMessage = typeof whatsappMessages.$inferSelect;

/** The conversation as it reads: one row per message, same id as silver. */
export const goldWhatsappConversation = gold.table(
  "whatsapp_conversation",
  {
    id: uuid("id").primaryKey(),
    waMessageId: text("wa_message_id").notNull(),
    contact: text("contact").notNull(),
    /** "Thierry", "Kevin" (from the allowlist). */
    contactName: text("contact_name").notNull(),
    direction: text("direction").notNull(),
    kind: text("kind").notNull(),
    /** What the message says: the text, or the transcript of a voice note. Null for media without caption. */
    body: text("body"),
    text: text("text"),
    transcript: text("transcript"),
    mediaMime: text("media_mime"),
    replyToWaId: text("reply_to_wa_id"),
    outboxId: uuid("outbox_id"),
    delivery: text("delivery"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_whatsapp_conversation_contact_sent").on(t.contact, t.sentAt)],
);
export type GoldWhatsappMessage = typeof goldWhatsappConversation.$inferSelect;

export const outboxStatuses = ["queued", "sending", "sent", "failed", "refused"] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

/**
 * Messages to send. Any dimension INSERTs a row (recipient, text, optional image, reply_to, scheduled_at); the
 * service sends it once due and writes back status, wa_message_id or error. Recipients outside the allowlist are
 * refused, never sent.
 */
export const whatsappOutbox = app.table(
  "whatsapp_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Phone digits with country code ("15550000001"); "+" and spaces are tolerated and stripped. */
    recipient: text("recipient").notNull(),
    text: text("text"),
    /** Image to send, by URL or bytes; `text` becomes its caption. */
    imageUrl: text("image_url"),
    image: bytea("image"),
    imageMime: text("image_mime"),
    /** WhatsApp id of a message (gold.whatsapp_conversation.wa_message_id) to quote. */
    replyToWaId: text("reply_to_wa_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who queued it: a dimension name ("content-drafts") or "test". */
    requestedBy: text("requested_by").notNull(),
    status: text("status").$type<OutboxStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    waMessageId: text("wa_message_id"),
    error: text("error"),
    /** Bronze row recording the send result or refusal. */
    resultBronzeId: uuid("result_bronze_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_outbox_due").on(t.status, t.scheduledAt)],
);
export type OutboxRow = typeof whatsappOutbox.$inferSelect;

/** Baileys auth state (creds + signal keys), snapshotted from the service's disk so the device is transferable. */
export const whatsappAuth = app.table("whatsapp_auth", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const linkStatuses = ["starting", "waiting-for-scan", "linked", "logged-out"] as const;
export type LinkStatus = (typeof linkStatuses)[number];

/** Health of the linked device, one row (id "default"). Settings shows it, QR included while unlinked. */
export const whatsappLink = ops.table("whatsapp_link", {
  id: text("id").primaryKey(),
  status: text("status").$type<LinkStatus>().notNull(),
  /** Current QR as SVG markup while waiting for a scan; null otherwise. */
  qrSvg: text("qr_svg"),
  /** Number the device is linked to, digits. */
  phone: text("phone"),
  error: text("error"),
  /** Last time the service was alive (written on its idle poll, so up to that interval old). */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WhatsappLink = typeof whatsappLink.$inferSelect;
