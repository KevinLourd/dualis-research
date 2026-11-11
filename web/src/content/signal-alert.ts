/**
 * When a Signal Change is worth a WhatsApp: only when a STRONG signal appears (Thierry 2026-11-11: « I should only get
 * [a message] for a really strong signal. Otherwise i can just check myself »; narrows Kevin's 2026-11-09 « gets better »).
 * - no signal (none / noise) or weak -> strong
 * - a side flip (BUY <-> SELL) that lands strong
 * A weak signal never sends (it stays in the console Signals table); a strong one that weakens or goes away sends nothing.
 */
export type SignalStep = { fromSignal: string; fromStrength: string; toSignal: string; toStrength: string };

const level = (signal: string, strength: string): 0 | 1 | 2 => (signal === "none" || strength === "noise" ? 0 : strength === "strong" ? 2 : 1);

export function isUpgrade(c: SignalStep): boolean {
  if (level(c.toSignal, c.toStrength) !== 2) return false;
  return level(c.fromSignal, c.fromStrength) !== 2 || c.fromSignal !== c.toSignal;
}

/** The thesis a signal speaks for: a BUY is the long thesis (a bad story inflecting), a SELL the short one (a loved story cracking). */
export function sideOfSignal(signal: string): "long" | "short" {
  if (signal === "BUY") return "long";
  if (signal === "SELL") return "short";
  throw new Error(`no thesis side for signal ${signal}`);
}
