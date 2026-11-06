/**
 * The only people Dualis's WhatsApp device talks to. Everything else on the number is ignored (never stored, never
 * answered): the number is shared with another assistant that keeps those chats.
 * `lids` = WhatsApp's privacy ids for the same person (newer clients address chats by "<lid>@lid" instead of the phone).
 */
export type AllowedContact = { name: string; phone: string; lids: string[]; role: "client" | "test" };

/**
 * Read from the WHATSAPP_ALLOWLIST secret (JSON list of AllowedContact), never from the repo: the repo is public and
 * these are personal numbers. Missing or malformed fails loud: the device must never talk to an unknown list.
 */
export function allowlist(env: Record<string, string | undefined> = process.env): AllowedContact[] {
  const raw = env.WHATSAPP_ALLOWLIST;
  if (!raw) throw new Error("WHATSAPP_ALLOWLIST is not set (JSON list of { name, phone, lids, role })");
  const list = JSON.parse(raw) as AllowedContact[];
  if (!Array.isArray(list) || list.length === 0) throw new Error("WHATSAPP_ALLOWLIST must be a non-empty JSON list");
  for (const c of list) {
    if (!c.name || !/^[0-9]+$/.test(c.phone ?? "") || !Array.isArray(c.lids) || (c.role !== "client" && c.role !== "test")) {
      throw new Error(`WHATSAPP_ALLOWLIST: bad contact ${JSON.stringify(c.name ?? null)} (name, phone digits, lids list, role client|test)`);
    }
  }
  return list;
}

/** "+1 (555) 000-0001" -> "15550000001". */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** The user part of a JID: "15550000001:12@s.whatsapp.net" -> "15550000001", "1276@lid" -> "1276". */
export function jidUser(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

/**
 * The allowlisted contact behind any of the JIDs WhatsApp gives for a chat (phone JID, lid JID, or the alternate
 * one Baileys attaches), or null. Group, broadcast and newsletter chats never match.
 */
export function allowedContact(jids: (string | null | undefined)[], list: AllowedContact[] = allowlist()): AllowedContact | null {
  for (const jid of jids) {
    if (!jid) continue;
    const user = jidUser(jid);
    if (jid.endsWith("@s.whatsapp.net")) {
      const hit = list.find((c) => c.phone === user);
      if (hit) return hit;
    } else if (jid.endsWith("@lid")) {
      const hit = list.find((c) => c.lids.includes(user));
      if (hit) return hit;
    }
  }
  return null;
}

export function contactByPhone(phone: string, list: AllowedContact[] = allowlist()): AllowedContact | null {
  const digits = normalizePhone(phone);
  return list.find((c) => c.phone === digits) ?? null;
}

export function phoneJid(phone: string): string {
  return `${normalizePhone(phone)}@s.whatsapp.net`;
}
