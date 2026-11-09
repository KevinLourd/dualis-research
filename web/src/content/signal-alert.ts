/**
 * When a Signal Change is worth a WhatsApp (Kevin 2026-11-09): only when the signal gets BETTER, i.e. louder or turned.
 * - no signal (none / noise) -> weak or strong
 * - weak -> strong on the same side
 * - inflection <-> crack (BUY <-> SELL), whatever the strength
 * A signal that weakens or goes away (strong -> weak, anything -> no signal) sends nothing.
 */
export type SignalStep = { fromSignal: string; fromStrength: string; toSignal: string; toStrength: string };

const level = (signal: string, strength: string): 0 | 1 | 2 => (signal === "none" || strength === "noise" ? 0 : strength === "strong" ? 2 : 1);

export function isUpgrade(c: SignalStep): boolean {
  const to = level(c.toSignal, c.toStrength);
  if (to === 0) return false;
  const from = level(c.fromSignal, c.fromStrength);
  if (from === 0) return true;
  if (c.fromSignal !== c.toSignal) return true;
  return to > from;
}

/** The thesis a signal speaks for: a BUY is the long thesis (a bad story inflecting), a SELL the short one (a loved story cracking). */
export function sideOfSignal(signal: string): "long" | "short" {
  if (signal === "BUY") return "long";
  if (signal === "SELL") return "short";
  throw new Error(`no thesis side for signal ${signal}`);
}
