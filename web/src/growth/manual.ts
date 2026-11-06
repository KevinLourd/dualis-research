import { eq } from "drizzle-orm";
import { CONSOLE_SOURCE, OUTREACH_DIMENSION, promoteOutreach, type ConsoleOutreachEdit } from "@/collectors/dimensions/growth-outreach";
import { fetches } from "@/db/schema/bronze";
import { outreachStatusValues } from "@/db/schema/growth";
import { runSources, runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";

/**
 * Thierry's edit of a message or change of its status, recorded like any other source: one ops run
 * (trigger "console"), one bronze row (dimension growth-outreach, source "console"), then the outreach promotion.
 * Fails loud: a promotion error marks the run failed and is rethrown to the page.
 */
export async function recordOutreachEdit(db: Db, handle: string, edit: ConsoleOutreachEdit): Promise<void> {
  if (edit.status && !outreachStatusValues.includes(edit.status)) throw new Error(`unknown outreach status ${edit.status}`);
  if (edit.body !== undefined && !edit.body.trim()) throw new Error("the message cannot be empty");
  const started = Date.now();
  const [run] = await db.insert(runs).values({ dimension: OUTREACH_DIMENSION, trigger: "console" }).returning({ id: runs.id });
  const [row] = await db
    .insert(fetches)
    .values({
      runId: run.id,
      dimension: OUTREACH_DIMENSION,
      source: CONSOLE_SOURCE,
      subject: `outreach:${handle}`,
      request: { handle, fields: Object.keys(edit).filter((k) => k !== "userId"), userId: edit.userId },
      httpStatus: null,
      payload: edit,
    })
    .returning();
  try {
    await promoteOutreach(db, [row]);
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
