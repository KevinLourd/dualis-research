import type { MessageKind } from "../db/schema/whatsapp";

/**
 * Reads a raw WhatsApp message (Baileys WAMessage as stored in bronze, JSON) into the fields silver keeps.
 * Pure: no Baileys import, so it runs anywhere (tests, promoter).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export type ParsedMessage = {
  waMessageId: string;
  fromMe: boolean;
  kind: MessageKind;
  text: string | null;
  mediaMime: string | null;
  replyToWaId: string | null;
  sentAt: Date;
  /** Media worth downloading (voice, audio, image, video, document). */
  hasMedia: boolean;
};

/** Protobuf Long as JSON: a number, a numeric string, or { low, high }. */
export function toSeconds(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return Number(ts);
  if (typeof ts === "object" && "low" in (ts as Raw)) {
    const { low, high } = ts as { low: number; high: number };
    return (high >>> 0) * 2 ** 32 + (low >>> 0);
  }
  return null;
}

/** Unwraps the containers WhatsApp nests real content in (ephemeral, view-once, edited...). */
function unwrap(m: Raw): Raw {
  let cur = m;
  for (let i = 0; i < 5 && cur; i++) {
    const inner =
      cur.ephemeralMessage?.message ??
      cur.viewOnceMessage?.message ??
      cur.viewOnceMessageV2?.message ??
      cur.viewOnceMessageV2Extension?.message ??
      cur.documentWithCaptionMessage?.message ??
      cur.editedMessage?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur ?? {};
}

export function parseMessage(raw: Raw): ParsedMessage {
  const m = unwrap(raw.message ?? {});
  const seconds = toSeconds(raw.messageTimestamp);
  const base = {
    waMessageId: String(raw.key?.id),
    fromMe: Boolean(raw.key?.fromMe),
    sentAt: seconds ? new Date(seconds * 1000) : new Date(),
  };
  const ctx = (m.extendedTextMessage ?? m.imageMessage ?? m.audioMessage ?? m.videoMessage ?? m.documentMessage ?? m.stickerMessage)?.contextInfo;
  const replyToWaId: string | null = ctx?.stanzaId ?? null;
  const out = (kind: MessageKind, text: string | null, mediaMime: string | null = null, hasMedia = false): ParsedMessage => ({
    ...base,
    kind,
    text: text || null,
    mediaMime,
    replyToWaId,
    hasMedia,
  });
  if (typeof m.conversation === "string") return out("text", m.conversation);
  if (m.extendedTextMessage) return out("text", m.extendedTextMessage.text ?? null);
  if (m.audioMessage) return out(m.audioMessage.ptt ? "voice" : "audio", null, m.audioMessage.mimetype ?? "audio/ogg", true);
  if (m.imageMessage) return out("image", m.imageMessage.caption ?? null, m.imageMessage.mimetype ?? "image/jpeg", true);
  if (m.videoMessage) return out("video", m.videoMessage.caption ?? null, m.videoMessage.mimetype ?? "video/mp4", true);
  if (m.documentMessage) return out("document", m.documentMessage.caption ?? m.documentMessage.fileName ?? null, m.documentMessage.mimetype ?? null, true);
  if (m.stickerMessage) return out("sticker", null, m.stickerMessage.mimetype ?? "image/webp");
  if (m.reactionMessage) return { ...out("reaction", m.reactionMessage.text ?? null), replyToWaId: m.reactionMessage.key?.id ?? null };
  return out("other", null);
}

/**
 * Messages that are protocol noise, not something a person wrote (key distribution, revokes, history markers...).
 * Never stored.
 */
export function isNoise(raw: Raw): boolean {
  const m = raw.message;
  if (!m) return true;
  const keys = Object.keys(m).filter((k) => k !== "messageContextInfo");
  return keys.length === 0 || keys.every((k) => k === "senderKeyDistributionMessage" || k === "protocolMessage");
}
