/**
 * November goal (CLAUDE.md, skill `audience`): +1K Substack subscribers on Analysis Paralysis by 2026-11-30: 153 on 2026-11-04 (Kevin, Substack dashboard) to 1,153.
 * Pure, so the page and tests share it.
 */
export const GOAL = { startDate: "2026-11-04", start: 153, endDate: "2026-11-30", target: 1153 } as const;

const DAY = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Where the straight line from the start to the target stands on `date` (inclusive of the end day). */
export function planned(date: string): number {
  const total = (day(GOAL.endDate) - day(GOAL.startDate)) / DAY;
  const elapsed = Math.min(Math.max((day(date) - day(GOAL.startDate)) / DAY, 0), total);
  return Math.round(GOAL.start + ((GOAL.target - GOAL.start) * elapsed) / total);
}

/** Today's position against the goal: still to win, days left (today counts), and the pace needed per day. */
export function progress(latest: { date: string; subscribers: number } | null, today: string) {
  const current = latest?.subscribers ?? GOAL.start;
  const remaining = Math.max(GOAL.target - current, 0);
  const daysLeft = Math.max(Math.round((day(GOAL.endDate) - day(today)) / DAY) + 1, 1);
  return {
    current,
    gained: current - GOAL.start,
    remaining,
    daysLeft,
    perDayNeeded: Math.ceil(remaining / daysLeft),
    plannedToday: planned(today),
    /** Positive = ahead of the straight line. */
    vsPlan: current - planned(today),
  };
}
