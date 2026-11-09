/**
 * How a narrative state reads, in Thierry's words (docs/thierry-method.md): on a long, a cracking bad story is the
 * narrative INFLECTING; on a short (or a name he only watches) it is CRACKING. Pure: the console and WhatsApp share it.
 */
export function stateWord(state: string, position: string | null): string {
  if (state === "cracking") return position === "long" ? "Inflecting" : "Cracking";
  if (state === "holds") return "Holds";
  return state;
}

/** The one-line signal: "*PAL*: the narrative is inflecting." */
export function signalHeadline(symbol: string, toState: string, position: string | null): string {
  return toState === "holds" ? `*${symbol}*: the narrative holds again.` : `*${symbol}*: the narrative is ${stateWord(toState, position).toLowerCase()}.`;
}

/** Price vs Thierry's own fair value: above or below, by how much. Never an AI number. */
export function gapOf(price: number | null, fairValue: number | null): { pct: number; side: "below" | "above" } | null {
  if (price === null || fairValue === null || !(price > 0) || !(fairValue > 0)) return null;
  const pct = (price - fairValue) / fairValue;
  return { pct: Math.abs(pct), side: pct < 0 ? "below" : "above" };
}

/** The call a signal makes (gold.signals): BUY only below the fair value, SELL only above it (docs/thierry-method.md). */
export type SignalCall = "BUY" | "SELL";

export type SignalStrength = "strong" | "weak" | "noise";
/** The judge's confidence a contradicting news needs to be Strong, for a ticker not analysed into drivers yet. */
export const STRONG_MIN_PROBABILITY = 0.7;

export const STRENGTH_WORD: Record<SignalStrength, string> = { strong: "Strong", weak: "Weak", noise: "Noise" };

/** A position's return: the sign flips on a short. */
export function positionReturn(entry: number | null, current: number | null, direction: string | null): number | null {
  if (entry === null || current === null || !(entry > 0) || (direction !== "long" && direction !== "short")) return null;
  const r = current / entry - 1;
  return direction === "short" ? -r : r;
}

/** One judged news or filing against the narrative: Strong / Weak crack, or Noise (it only continues the story). */
export function evidenceStrength(direction: string, probability: number): SignalStrength {
  if (direction !== "contradicts") return "noise";
  return probability >= STRONG_MIN_PROBABILITY ? "strong" : "weak";
}

/**
 * A narrative tag in Thierry's words (Kevin 2026-11-06): stored as reversal / continuation / noise; a reversal reads
 * "Inflection" on the long thesis (a bad story turning) and "Crack" on the short thesis (a loved story breaking). The
 * thesis decides the word, never where the price sits (Kevin 2026-11-09: NVRI's good Q3 read "Crack" at +0.2%).
 */
export function tagWord(effect: string, strength: string, side: "long" | "short" | null): string {
  if (effect === "too-old") return "Too old";
  if (effect === "noise" || strength === "noise") return "Noise";
  const s = strength === "strong" ? "Strong" : "Weak";
  if (effect === "continuation") return `${s} continuation`;
  return `${s} ${side === null ? "reversal" : side === "long" ? "inflection" : "crack"}`;
}
