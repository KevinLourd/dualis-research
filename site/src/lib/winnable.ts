import type { Variant } from "@/components/poker-formations";

/**
 * The site's thread (Thierry 2026-11-06, Kevin 2026-11-09): « play winnable games ». A poker player picks the table
 * where they hold an edge; Dualis picks the markets where it does. Each page shows its own poker scene and one short
 * line of the analogy. `label` = what a screen reader hears for the scene.
 */
export const WINNABLE: Record<Variant, { line: string; label: string }> = {
  home: { line: "Play winnable games.", label: "Points of light gather into poker players around a turning table, then scatter." },
  company: { line: "Pick the table before you play a hand.", label: "Three poker tables form, then one table remains: the one worth sitting at." },
  research: { line: "Each report shows the hand behind the call.", label: "Points of light gather into a fanned hand of five cards." },
  portfolio: { line: "Every stack starts as a published call.", label: "Chip stacks rise on a poker table like a growth chart." },
  about: { line: "Thierry picks his table first, then plays the odds.", label: "One player sits at a poker table, cards and chips in front of him." },
  contact: { line: "Pull up a chair. Thierry reads every message.", label: "Two players face each other across a poker table." },
  plans: { line: "One seat at the table is yours.", label: "Five players sit at a poker table beside one empty chair." },
};
