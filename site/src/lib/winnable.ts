/**
 * The site's thread (Thierry 2026-11-06): « play winnable games ». A poker player picks the table where they hold an
 * edge; Dualis picks the markets where it does. One short line of the analogy per page. No point animation
 * (Kevin 2026-11-09: removed).
 */
export type ThreadPage = "home" | "company" | "research" | "team" | "contact" | "plans";

export const WINNABLE: Record<ThreadPage, string> = {
  home: "Play winnable games.",
  company: "Pick the table before you play a hand.",
  research: "Each report shows the hand behind the call.",
  team: "Pick the table first, then play the odds.",
  contact: "Pull up a chair. Every message gets read.",
  plans: "One seat at the table is yours.",
};
