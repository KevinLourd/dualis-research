import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./types";

/**
 * A database that supports transactions, for console writes (the read client over Neon HTTP cannot run one).
 * Neon goes over a WebSocket pool opened for this request and closed after it (Workers forbid sharing sockets
 * across requests); any other host (a local dev server) over postgres.js.
 */
export async function withWriteDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Neon connection string; see web/README.md)");
  if (new URL(url).hostname.endsWith(".neon.tech")) {
    const pool = new Pool({ connectionString: url });
    try {
      return await fn(drizzleNeonWs(pool) as unknown as Db);
    } finally {
      await pool.end();
    }
  }
  const client = postgres(url, { max: 1, fetch_types: false });
  try {
    return await fn(drizzlePostgres(client));
  } finally {
    await client.end();
  }
}
