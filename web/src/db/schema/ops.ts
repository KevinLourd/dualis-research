import { integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Operations: one row per collector run, one row per source inside it. */
export const ops = pgSchema("ops");

export const runStatusEnum = ops.enum("run_status", ["running", "succeeded", "partial", "failed"]);
export const sourceStatusEnum = ops.enum("source_status", ["ok", "partial", "failed", "skipped"]);

export const runs = ops.table("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  dimension: text("dimension").notNull(),
  /** "schedule" (GitHub cron), "manual" (workflow_dispatch), "local" (a developer's shell), "test". */
  trigger: text("trigger").notNull(),
  status: runStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Link to the GitHub Actions run when the run came from CI. */
  ciUrl: text("ci_url"),
  /** Set when the run died outside a source (promotion, database). */
  error: text("error"),
});

export type RunSourceError = { subject: string; message: string };

export const runSources = ops.table("run_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  status: sourceStatusEnum("status").notNull(),
  /** Subjects this source was asked for (tickers, files). */
  requested: integer("requested").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  /** Subjects the source does not cover (e.g. FMP free tier: US only). */
  skipped: integer("skipped").notNull().default(0),
  bronzeRows: integer("bronze_rows").notNull().default(0),
  silverRows: integer("silver_rows").notNull().default(0),
  /** First errors of the run, capped, so the Data page can show why. */
  errors: jsonb("errors").$type<RunSourceError[]>().notNull().default([]),
  durationMs: integer("duration_ms").notNull().default(0),
});
