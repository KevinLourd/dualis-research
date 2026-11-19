import { Badge } from "@cloudflare/kumo";
import type { ConfidenceLevel } from "@/db/schema/analysis";

const WORD: Record<ConfidenceLevel, string> = { strong: "Strong confidence", weak: "Weak confidence", noise: "Noise" };
const VARIANT = { strong: "success", weak: "warning", noise: "neutral" } as const;

/** How far a Narrative Driver can be trusted (driver-confidence): did the market trade the stock on it again? */
export function ConfidenceBadge({ level }: { level: ConfidenceLevel | null }) {
  if (!level) return <span className="text-sm text-kumo-subtle">Not tested yet</span>;
  return (
    <Badge appearance="dot" variant={VARIANT[level]}>
      {WORD[level]}
    </Badge>
  );
}
