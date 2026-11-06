import type { DeliveryState } from "../db/schema/whatsapp";
import { type AllowedContact, allowedContact } from "./allowlist";
import { isNoise, parseMessage } from "./parse";
import { type BronzeEntry, type MessageRequest, SOURCE_WHATSAPP } from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** Every JID WhatsApp may use for the other side of a 1:1 chat (phone or lid, plus Baileys' alternates). */
function chatJids(key: Raw): string[] {
  return [key?.remoteJid, key?.remoteJidAlt, key?.senderPn, key?.participant, key?.participantAlt].filter(Boolean);
}

/**
 * A raw message from the socket -> its bronze entry, or null when it is not ours to keep: a chat outside the
 * allowlist (the number's other assistant keeps those), a group, or protocol noise.
 */
export function inboundEntry(raw: Raw): { contact: AllowedContact; entry: BronzeEntry; hasMedia: boolean; isVoice: boolean } | null {
  const remote: string = raw?.key?.remoteJid ?? "";
  if (!remote || remote.endsWith("@g.us") || remote.endsWith("@broadcast") || remote.endsWith("@newsletter")) return null;
  const contact = allowedContact(chatJids(raw.key));
  if (!contact || isNoise(raw)) return null;
  const p = parseMessage(raw);
  const request: MessageRequest = { contact: contact.phone, direction: p.fromMe ? "out" : "in" };
  return {
    contact,
    entry: { source: SOURCE_WHATSAPP, subject: `message:${p.waMessageId}`, request, payload: raw },
    hasMedia: p.hasMedia,
    isVoice: p.kind === "voice" || p.kind === "audio",
  };
}

/** WhatsApp's numeric message status (proto WebMessageInfo.Status) -> our delivery ladder. */
const STATUS: Record<number, DeliveryState> = { 1: "pending", 2: "sent", 3: "delivered", 4: "read", 5: "played" };

/** A status update from the socket -> a receipt entry, or null (not an allowlisted chat, or not a status). */
export function receiptEntry(update: Raw): BronzeEntry | null {
  const status = STATUS[update?.update?.status as number];
  if (!status || !update?.key?.id) return null;
  const contact = allowedContact(chatJids(update.key));
  if (!contact) return null;
  return { source: SOURCE_WHATSAPP, subject: `receipt:${update.key.id}`, request: { contact: contact.phone }, payload: { status } };
}
