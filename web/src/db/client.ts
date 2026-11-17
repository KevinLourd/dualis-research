import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./types";
import { databaseUrl } from "./url";

let pool: Db | undefined;

/**
 * The console's database: ONE pool for the Node server process (web/deploy/README.md), shared by every request.
 * Up to 10 connections, closed after a minute idle.
 */
export function getDb(): Db {
  pool ??= drizzle(postgres(databaseUrl(), { max: 10, idle_timeout: 60, fetch_types: false }));
  return pool;
}
