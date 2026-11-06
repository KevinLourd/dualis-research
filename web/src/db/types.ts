import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Any drizzle Postgres database: neon-http (Workers), postgres.js (Node, CI), PGlite (tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;
