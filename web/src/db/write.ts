import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./types";
import { requestDatabaseUrl } from "./url";

/** A database for console writes, opened for this request and closed after it (Workers forbid sharing sockets). */
export async function withWriteDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = postgres(requestDatabaseUrl(), { max: 1, fetch_types: false });
  try {
    return await fn(drizzle(client));
  } finally {
    await client.end();
  }
}
