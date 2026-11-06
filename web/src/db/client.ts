import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { cache } from "react";
import type { Db } from "./types";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Neon connection string; see web/README.md)");
  return url;
}

/**
 * Database for the web app, one per request (Workers forbid sharing a socket across requests).
 * Neon hosts go over HTTP (no socket at all); any other host (a local dev server) over postgres.js.
 */
export const getDb = cache((): Db => {
  const url = databaseUrl();
  if (new URL(url).hostname.endsWith(".neon.tech")) return drizzleNeon(neon(url));
  return drizzlePostgres(postgres(url, { max: 1, fetch_types: false }));
});
