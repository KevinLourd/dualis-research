import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";
import { cache } from "react";

export type Row = Record<string, unknown>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

type HyperdriveEnv = { HYPERDRIVE?: { connectionString: string } };

/**
 * On Workers: the Hyperdrive binding (site/wrangler.jsonc), which speaks TLS to the database for us (the bundled
 * postgres.js cannot, 2026-11-17). Elsewhere (local dev): DATABASE_URL. Same as web/src/db/url.ts.
 */
function databaseUrl(): string {
  if (navigator.userAgent === "Cloudflare-Workers") {
    const hyperdrive = (getCloudflareContext().env as HyperdriveEnv).HYPERDRIVE;
    if (!hyperdrive) throw new Error("HYPERDRIVE binding is missing (site/wrangler.jsonc)");
    return hyperdrive.connectionString;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (the console's database, read-only use)");
  return url;
}

/** Read-only access to the console's gold tables, one client per request (Workers forbid sharing a socket). */
export const getSql = cache((): Sql => {
  const q = postgres(databaseUrl(), { max: 1, fetch_types: false });
  return (strings, ...values) => q(strings, ...(values as never[])) as unknown as Promise<Row[]>;
});
