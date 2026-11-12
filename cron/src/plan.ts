/**
 * The collect schedule (Kevin 2026-11-12). GitHub's own `schedule:` is best effort on the free plan: runs came 2-6 h
 * late or never (2026-11-12: no 01:15, 02:00 or 05:15 run, so no 08:00 Growth brief). A Cloudflare Cron Trigger fires
 * on time ($0, 5 per account) and starts `collect.yml` with the dimension each slot runs.
 */
export const SCHEDULE: Record<string, string> = {
  "15 5 * * *": "all", // 05:15 UTC, before the European open: everything
  "15 1,9,13,17,21 * * *": "core", // the analysis chain only
  "0 2 * * *": "growth-outreach,substack-network,growth-brief", // 07:00 Astana: fresh count, then the 08:00 Growth brief
};

export const REPO = "KevinLourd/dualis-research";
export const WORKFLOW = "collect.yml";

/** The workflow_dispatch body for one cron slot. Throws on a cron this file does not know (wrangler.jsonc drifted). */
export function dispatchBody(cron: string): { ref: string; inputs: { dimension: string; trigger: string } } {
  const dimension = SCHEDULE[cron];
  if (!dimension) throw new Error(`Unknown cron "${cron}": add it to SCHEDULE in cron/src/plan.ts`);
  return { ref: "main", inputs: { dimension, trigger: "schedule" } };
}
