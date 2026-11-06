import { normalizePhone } from "./allowlist";

/** A pairing request older than this is ignored: the person has left the page. */
export const PAIRING_FRESH_MS = 10 * 60_000;

/** The number typed in Settings, as WhatsApp wants it for a pairing code: digits with the country code. */
export function pairingPhone(raw: string): string {
  const digits = normalizePhone(raw);
  if (digits.length < 8 || digits.length > 15) throw new Error("Type the full number with its country code, for example +7 701 000 0000");
  return digits;
}

/** True when the service should ask WhatsApp for a (new) code: a fresh request it has not answered on this connection. */
export function pairingDue(row: { pairingPhone: string | null; pairingRequestedAt: Date | null } | undefined, answered: { requestedAt: number; connection: unknown } | null, connection: unknown, now: number): boolean {
  if (!row?.pairingPhone || !row.pairingRequestedAt) return false;
  const at = row.pairingRequestedAt.getTime();
  if (now - at > PAIRING_FRESH_MS) return false;
  return !answered || answered.requestedAt !== at || answered.connection !== connection;
}

/** "ABCD1234" -> "ABCD-1234", how WhatsApp shows it. */
export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
