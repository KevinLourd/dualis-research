import { Badge } from "@cloudflare/kumo";
import { tagWord } from "@/content/signal-words";

const LASTING: Record<string, string> = { structural: "Structural", temporary: "Temporary" };

/**
 * A narrative tag (news x driver, driver, ticker): a reversal in colour (strong green, weak amber), continuation and
 * noise in grey. A driver's turn carries whether it lasts (« Weak inflection · Temporary », Thierry 2026-11-17).
 */
export function TagBadge({ effect, strength, side, durability }: { effect: string; strength: string; side: "long" | "short" | null; durability?: string | null }) {
  const variant = effect === "reversal" && strength !== "noise" ? (strength === "strong" ? "success" : "warning") : "neutral";
  const lasting = effect === "reversal" && durability ? LASTING[durability] : undefined;
  return (
    <Badge appearance="dot" variant={variant}>
      {lasting ? `${tagWord(effect, strength, side)} · ${lasting}` : tagWord(effect, strength, side)}
    </Badge>
  );
}
