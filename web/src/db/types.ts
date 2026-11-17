import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Any drizzle Postgres database: postgres.js (Workers through Hyperdrive, Node, CI), PGlite (tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;
