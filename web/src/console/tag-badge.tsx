import { Badge } from "@cloudflare/kumo";
import { tagWord } from "@/content/signal-words";

/** A narrative tag (news x driver, driver, ticker): a reversal in colour (strong green, weak amber), continuation and noise in grey. */
export function TagBadge({ effect, strength, side }: { effect: string; strength: string; side: "long" | "short" | null }) {
  const variant = effect === "reversal" && strength !== "noise" ? (strength === "strong" ? "success" : "warning") : "neutral";
  return (
    <Badge appearance="dot" variant={variant}>
      {tagWord(effect, strength, side)}
    </Badge>
  );
}
