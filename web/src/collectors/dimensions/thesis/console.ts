import { eq } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import { runSources, runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";
import { promoteThesis, type ConsoleEdit } from ".";
import { THESIS_DIMENSION } from "./gold";
import { CONSOLE_SOURCE } from "./sources";

/**
 * An edit or accept Thierry makes in the console, recorded like any other authored version:
 * one ops run (trigger "console"), one bronze row (source "console"), then the thesis promotion for it.
 * Fails loud: a promotion error marks the run failed and is rethrown to the page.
 */
export async function recordConsoleEdit(db: Db, symbol: string, edit: ConsoleEdit, today?: string): Promise<void> {
  const started = Date.now();
  const [run] = await db.insert(runs).values({ dimension: THESIS_DIMENSION, trigger: "console" }).returning({ id: runs.id });
  const [row] = await db
    .insert(fetches)
    .values({
      runId: run.id,
      dimension: THESIS_DIMENSION,
      source: CONSOLE_SOURCE,
      subject: symbol,
      request: { field: edit.field, action: edit.action, userId: edit.userId },
      httpStatus: null,
      payload: edit,
    })
    .returning();
  try {
    await promoteThesis(db, [row], today);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(runs).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(runs.id, run.id));
    throw err;
  }
  await db.insert(runSources).values({
    runId: run.id,
    source: CONSOLE_SOURCE,
    status: "ok",
    requested: 1,
    succeeded: 1,
    bronzeRows: 1,
    silverRows: 1,
    durationMs: Date.now() - started,
  });
  await db.update(runs).set({ status: "succeeded", finishedAt: new Date() }).where(eq(runs.id, run.id));
}
