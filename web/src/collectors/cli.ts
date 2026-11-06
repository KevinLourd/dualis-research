import { connectNode } from "@/db/node";
import { completeWithSubscription } from "@/llm/complete";
import { collectPlan, DIMENSIONS, dimensionsFor, stagesFor } from "./registry";
import { runDimension } from "./runner";

/**
 * pnpm collect <dimension|all>
 * Exit code 1 when a run FAILED (every source failed, or promotion threw); partial runs exit 0 and show on the Data page.
 */
async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error(`usage: pnpm collect <${["all", "core", "growth", "from:<dimension>", "plan <files...>", ...DIMENSIONS.map((d) => d.name)].join("|")}>`);
  // `plan <files...>`: print what a merge touching these files must collect (empty = nothing), for deploy.yml.
  if (arg === "plan") {
    console.log(collectPlan(process.argv.slice(3)) ?? "");
    return;
  }
  const stages = stagesFor(dimensionsFor(arg));
  const trigger = process.env.COLLECT_TRIGGER ?? "local";
  const ciUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const { db, close } = connectNode();
  let failed = false;
  try {
    for (const stage of stages) {
      // One stage at once: its dimensions read only what earlier stages wrote (registry STAGES).
      const reports = await Promise.all(stage.map(async (dimension) => ({ dimension, report: await runDimension(db, dimension, { trigger, ciUrl, ctx: { env: process.env, fetch, complete: completeWithSubscription } }) })));
      for (const { dimension, report } of reports) {
        console.log(`[collector:${dimension.name}] ${report.status} (run ${report.runId})`);
        for (const s of report.sources) {
          console.log(
            `  ${s.source}: ${s.status} ok=${s.succeeded} failed=${s.failed} skipped=${s.skipped} silver=${s.silverRows}` +
              (s.errors.length ? ` first error: ${s.errors[0].subject}: ${s.errors[0].message}` : ""),
          );
        }
        if (report.status === "failed") failed = true;
      }
    }
  } finally {
    await close();
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("[collector]", err);
  process.exit(1);
});
