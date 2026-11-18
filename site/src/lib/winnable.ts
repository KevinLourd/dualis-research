/**
 * The site's thread (Thierry 2026-11-06): « play winnable games ». A poker player picks the table where they hold an
 * edge; Dualis picks the markets where it does. One short line of the analogy per page. No point animation
 * (Kevin 2026-11-09: removed). Home, Research and Company carry none (Thierry 2026-11-17).
 */
export type ThreadPage = "team" | "contact" | "plans";

export const WINNABLE: Record<ThreadPage, string> = {
  team: "Pick the table first, then play the odds.",
  contact: "Pull up a chair. Every message gets read.",
  plans: "One seat at the table is yours.",
};
