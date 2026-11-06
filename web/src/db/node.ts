import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "./types";

/**
 * Database for Node scripts (collectors, migrations) over TCP. Call `close()` when done.
 * Uses Neon's DIRECT connection (DATABASE_URL_UNPOOLED) when set: migrations and transactions need a session,
 * which the pooled (-pooler, PgBouncer transaction mode) URL does not keep. Locally, DATABASE_URL alone is enough.
 */
export function connectNode(): { db: Db; close: () => Promise<void> } {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL is not set (Neon connection strings; see web/README.md)");
  // Neon: 4 connections, a collect stage runs its dimensions at once (registry STAGES). Locally one: what a PGlite dev server accepts.
  const client = postgres(url, { max: url.includes("neon.tech") ? 4 : 1, onnotice: () => {} });
  return { db: drizzle(client), close: () => client.end() };
}
