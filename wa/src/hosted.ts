import { contentDispatch } from "@/collectors/dimensions/content-dispatch";
import { contentReplies } from "@/collectors/dimensions/content-replies";
import { runDimension } from "@/collectors/runner";
import type { Dimension } from "@/collectors/types";
import type { Db } from "@/db/types";
import { completeWithSubscription } from "@/llm/complete";

/**
 * Collector dimensions that must react faster than the daily GitHub cron, run inside this service with the same
 * context as `pnpm collect` (Kevin's Claude subscription, never the paid API key).
 * - content-replies: Thierry's answers to a draft, a few seconds after his message (voice: after its transcript).
 * - content-dispatch: drafts at their slot, on the idle tick (Signal Change alerts: `signal-alerts`, in the collect).
 */
export const ON_INBOUND: Dimension = contentReplies;
export const ON_IDLE_TICK: Dimension = contentDispatch;

export async function runHosted(db: Db, dimension: Dimension, trigger: string) {
  const started = Date.now();
  const report = await runDimension(db, dimension, { trigger, ctx: { env: process.env, fetch, complete: completeWithSubscription } });
  const errors = report.sources.flatMap((s) => s.errors.map((e) => `${s.source} ${e.subject}: ${e.message}`));
  console.log(`[wa] ${dimension.name}: ${report.status} in ${Date.now() - started} ms (run ${report.runId})${errors.length ? ` first error: ${errors[0]}` : ""}`);
  return report;
}
