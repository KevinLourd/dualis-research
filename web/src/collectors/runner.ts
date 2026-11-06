import { eq } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import { type RunSourceError, runSources, runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";
import type { Dimension, Source, SourceContext } from "./types";

const MAX_ERRORS_KEPT = 20;
/** Upper bound on crawl rounds of an `expand` dimension. */
const MAX_ROUNDS = 10;

type SourceTally = {
  source: string;
  status: "ok" | "partial" | "failed" | "skipped";
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  bronzeRows: number;
  errors: RunSourceError[];
  durationMs: number;
};

export type RunReport = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  sources: (SourceTally & { silverRows: number })[];
  error: string | null;
};

/**
 * Runs one dimension: fetch every (source x subject) into bronze, promote this run's bronze to silver + gold,
 * and record the run with per-source status, counts and errors in ops.runs / ops.run_sources.
 * Never throws for a source failure (it is recorded); throws only if the run itself could not be recorded.
 */
export async function runDimension(
  db: Db,
  dimension: Dimension,
  opts: { trigger: string; ciUrl?: string | null; ctx: SourceContext },
): Promise<RunReport> {
  const [run] = await db
    .insert(runs)
    .values({ dimension: dimension.name, trigger: opts.trigger, ciUrl: opts.ciUrl ?? null })
    .returning({ id: runs.id });

  let tallies: SourceTally[] = [];
  let silverRowsBySource: Record<string, number> = {};
  let runError: string | null = null;
  // ONE context for every source and subject of the run: per-run memos (`memo(ctx, ...)`) key on its identity.
  const ctx: SourceContext = { ...opts.ctx, db };
  try {
    let subjects = await dimension.subjects(db, ctx);
    const fetched = new Set<string>();
    for (let round = 0; round < MAX_ROUNDS && subjects.length > 0; round++) {
      subjects.forEach((x) => fetched.add(x));
      const roundTallies = await Promise.all(
        dimension.sources.map((source) => fetchSource(db, run.id, dimension.name, source, subjects, ctx)),
      );
      tallies = tallies.length === 0 ? roundTallies : tallies.map((t, i) => mergeTallies(t, roundTallies[i]));
      if (!dimension.expand) break;
      const soFar = await db.select().from(fetches).where(eq(fetches.runId, run.id));
      subjects = [...new Set(await dimension.expand(db, soFar, round + 1))].filter((x) => !fetched.has(x));
    }
    const bronzeRows = await db.select().from(fetches).where(eq(fetches.runId, run.id));
    ({ silverRowsBySource } = await dimension.promote(db, bronzeRows, opts.ctx));
  } catch (err) {
    runError = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[collector:${dimension.name}] run failed`, err);
  }

  const status = runStatus(tallies, runError);
  if (tallies.length > 0) {
    await db.insert(runSources).values(
      tallies.map((t) => ({ runId: run.id, ...t, silverRows: silverRowsBySource[t.source] ?? 0 })),
    );
  }
  await db.update(runs).set({ status, finishedAt: new Date(), error: runError }).where(eq(runs.id, run.id));

  return {
    runId: run.id,
    status,
    sources: tallies.map((t) => ({ ...t, silverRows: silverRowsBySource[t.source] ?? 0 })),
    error: runError,
  };
}

async function fetchSource(
  db: Db,
  runId: string,
  dimension: string,
  source: Source,
  subjects: string[],
  ctx: SourceContext,
): Promise<SourceTally> {
  const started = Date.now();
  const covered = subjects.filter((s) => source.covers(s));
  const tally: SourceTally = {
    source: source.name,
    status: "ok",
    requested: covered.length,
    succeeded: 0,
    failed: 0,
    skipped: subjects.length - covered.length,
    bronzeRows: 0,
    errors: [],
    durationMs: 0,
  };

  const missing = source.requiredEnv.filter((name) => !ctx.env[name]);
  if (missing.length > 0) {
    tally.status = "failed";
    tally.failed = covered.length;
    tally.errors.push({ subject: "*", message: `missing env: ${missing.join(", ")}` });
    tally.durationMs = Date.now() - started;
    return tally;
  }

  const queue = [...covered];
  const worker = async () => {
    for (let subject = queue.shift(); subject !== undefined; subject = queue.shift()) await fetchOne(subject);
  };
  const fetchOne = async (subject: string) => {
    let outcome;
    try {
      outcome = await source.fetch(subject, ctx);
    } catch (err) {
      outcome = { request: {}, httpStatus: null, error: err instanceof Error ? err.message : String(err) };
    }
    await db.insert(fetches).values({
      runId,
      dimension,
      source: source.name,
      subject,
      request: outcome.request,
      httpStatus: outcome.httpStatus,
      payload: outcome.payload ?? null,
      payloadText: outcome.payloadText ?? null,
      error: outcome.error ?? null,
    });
    tally.bronzeRows += 1;
    if (outcome.error) {
      tally.failed += 1;
      if (tally.errors.length < MAX_ERRORS_KEPT) tally.errors.push({ subject, message: outcome.error });
    } else {
      tally.succeeded += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, source.concurrency ?? 1) }, worker));

  tally.status =
    tally.requested === 0
      ? "skipped"
      : tally.failed === 0
        ? "ok"
        : tally.succeeded === 0
          ? "failed"
          : "partial";
  tally.durationMs = Date.now() - started;
  return tally;
}

function mergeTallies(a: SourceTally, b: SourceTally): SourceTally {
  const requested = a.requested + b.requested;
  const failed = a.failed + b.failed;
  const succeeded = a.succeeded + b.succeeded;
  return {
    source: a.source,
    status: requested === 0 ? "skipped" : failed === 0 ? "ok" : succeeded === 0 ? "failed" : "partial",
    requested,
    succeeded,
    failed,
    skipped: a.skipped + b.skipped,
    bronzeRows: a.bronzeRows + b.bronzeRows,
    errors: [...a.errors, ...b.errors].slice(0, MAX_ERRORS_KEPT),
    durationMs: a.durationMs + b.durationMs,
  };
}

function runStatus(tallies: SourceTally[], runError: string | null): RunReport["status"] {
  if (runError) return "failed";
  const fetched = tallies.filter((t) => t.status !== "skipped");
  if (fetched.length > 0 && fetched.every((t) => t.status === "failed")) return "failed";
  if (fetched.some((t) => t.status !== "ok")) return "partial";
  return "succeeded";
}
