import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { cache } from "react";

export type Row = Record<string, unknown>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/**
 * Read-only access to the console's gold tables, one client per request (Workers forbid sharing a socket).
 * Neon hosts go over HTTP; any other host (a local dev server) over postgres.js. Same pattern as web/src/db/client.ts.
 */
export const getSql = cache((): Sql => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (the console's Neon database, read-only use)");
  if (new URL(url).hostname.endsWith(".neon.tech")) {
    const q = neon(url);
    return (strings, ...values) => q(strings, ...values) as Promise<Row[]>;
  }
  const q = postgres(url, { max: 1, fetch_types: false });
  return (strings, ...values) => q(strings, ...(values as never[])) as unknown as Promise<Row[]>;
});
