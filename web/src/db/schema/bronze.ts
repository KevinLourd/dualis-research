import { index, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { runs } from "./ops";

/**
 * Bronze: the raw answer of every fetch, failures included. Append-only: never UPDATE or DELETE.
 * One generic table for every dimension, so a new dimension adds no bronze table.
 */
export const bronze = pgSchema("bronze");

export const fetches = bronze.table(
  "fetches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    dimension: text("dimension").notNull(),
    source: text("source").notNull(),
    /** What was asked for: a ticker symbol, a file path. */
    subject: text("subject").notNull(),
    /** The request WITHOUT secrets (url with the key stripped, params). */
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    /** HTTP status, null when the request never got an answer (network error, local file). */
    httpStatus: integer("http_status"),
    /** Parsed JSON body when the answer was JSON. */
    payload: jsonb("payload"),
    /** Raw body when it was not JSON (RSS, HTML, error text). */
    payloadText: text("payload_text"),
    /** Why this fetch failed; null on success. */
    error: text("error"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fetches_dimension_source_subject").on(t.dimension, t.source, t.subject, t.fetchedAt),
    index("fetches_run").on(t.runId),
  ],
);

export type BronzeFetch = typeof fetches.$inferSelect;
