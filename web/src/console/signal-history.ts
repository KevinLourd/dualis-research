/** "BUY, weak inflection" / "No signal": a signal in the words the console shows (a BUY is an inflection, a SELL a crack). */
export function signalWordsOf(signal: string, strength: string): string {
  if (signal === "none") return "No signal";
  return `${signal}, ${strength} ${signal === "BUY" ? "inflection" : "crack"}`;
}
