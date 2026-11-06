import { isoDate } from "@/collectors/markets";
import { GOAL, planned, progress } from "./goal";

/** Pure growth figures, shared by the Growth page and the morning WhatsApp brief: one computation, two surfaces. */

type OutreachLike = { status: string; statusAt: Date | null; recommendsUsSince: Date | null } | null;

/** The Astana day (UTC+5) of an instant: Thierry's and Kevin's calendar. */
export const astanaDay = (d: Date) => isoDate(new Date(d.getTime() + 5 * 3_600_000));

const nextDay = (d: string) => isoDate(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000));

/** Day by day since the goal started (Astana days), newest first: contacts (status set that day), recommendations first seen, subscribers. */
export function dailyOutreach(live: { outreach: OutreachLike }[], audience: { date: string; subscribers: number }[], today: string) {
  const out: { date: string; contacted: number; recommended: number; subscribers: number | null }[] = [];
  for (let d: string = GOAL.startDate; d <= today && d <= GOAL.endDate; d = nextDay(d)) {
    out.push({
      date: d,
      contacted: live.filter((r) => r.outreach && r.outreach.status !== "draft" && r.outreach.status !== "dropped" && r.outreach.statusAt && astanaDay(r.outreach.statusAt) === d).length,
      recommended: live.filter((r) => r.outreach?.recommendsUsSince && astanaDay(r.outreach.recommendsUsSince) === d).length,
      subscribers: audience.find((a) => a.date === d)?.subscribers ?? null,
    });
  }
  return out.reverse();
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type GrowthBrief = {
  /** Astana day the brief is for. */
  date: string;
  current: number;
  gained: number;
  remaining: number;
  perDayNeeded: number;
  daysLeft: number;
  vsPlan: number;
  /** Day the count was read (the latest count may be from yesterday). */
  countedOn: string | null;
  yesterday: { contacted: number; recommended: number };
  /** Subscribers per day, oldest first, for the chart. */
  actual: { date: string; value: number }[];
  /** The straight line from the start to the goal. */
  plan: { date: string; value: number }[];
};

/** Everything the morning brief shows, from the same gold rows the Growth page reads. */
export function growthBrief(audience: { date: string; subscribers: number }[], live: { outreach: OutreachLike }[], today: string): GrowthBrief {
  const latest = audience.at(-1) ?? null;
  const p = progress(latest, today);
  const yesterdayIso = isoDate(new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000));
  const y = dailyOutreach(live, audience, today).find((d) => d.date === yesterdayIso);
  return {
    date: today,
    current: p.current,
    gained: p.gained,
    remaining: p.remaining,
    perDayNeeded: p.perDayNeeded,
    daysLeft: p.daysLeft,
    vsPlan: p.vsPlan,
    countedOn: latest?.date ?? null,
    yesterday: { contacted: y?.contacted ?? 0, recommended: y?.recommended ?? 0 },
    actual: audience.filter((a) => a.date >= GOAL.startDate).map((a) => ({ date: a.date, value: a.subscribers })),
    plan: [GOAL.startDate, GOAL.endDate].map((date) => ({ date, value: planned(date) })),
  };
}

export const GROWTH_PAGE_URL = "https://dualis-console.dualis-research.workers.dev/growth";

/** The WhatsApp caption under the chart. Short lines, figures first. */
export function briefText(b: GrowthBrief): string {
  const line = b.vsPlan === 0 ? "On the line" : b.vsPlan > 0 ? `Ahead of the line by ${fmt(b.vsPlan)}` : `Behind the line by ${fmt(-b.vsPlan)}`;
  const counted = b.countedOn && b.countedOn !== b.date ? ` (counted ${dayLabel(b.countedOn)})` : "";
  return [
    `*Growth, ${dayLabel(b.date)}*`,
    `${fmt(b.current)} subscribers${counted}, ${b.gained >= 0 ? "+" : ""}${fmt(b.gained)} since ${dayLabel(GOAL.startDate)}`,
    `Goal ${fmt(GOAL.target)} by ${dayLabel(GOAL.endDate)}: ${fmt(b.remaining)} to go, ${fmt(b.perDayNeeded)} a day needed`,
    `${line}, ${b.daysLeft} days left`,
    `Yesterday: ${b.yesterday.contacted} ${b.yesterday.contacted === 1 ? "writer" : "writers"} contacted, ${b.yesterday.recommended} new ${b.yesterday.recommended === 1 ? "recommendation" : "recommendations"}`,
    GROWTH_PAGE_URL,
  ].join("\n");
}
