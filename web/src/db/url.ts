import { getCloudflareContext } from "@opennextjs/cloudflare";

type HyperdriveEnv = { HYPERDRIVE?: { connectionString: string } };

/**
 * Connection string for one request. On Workers: the Hyperdrive binding (wrangler.jsonc). Hyperdrive keeps a warm pool
 * next to the database and speaks TLS to it; the Worker's bundled postgres.js cannot upgrade its own socket to TLS
 * (the console hung on every data page when it dialled the database directly, 2026-11-17). Elsewhere (local dev,
 * tests): DATABASE_URL.
 */
export function requestDatabaseUrl(): string {
  if (navigator.userAgent === "Cloudflare-Workers") {
    const hyperdrive = (getCloudflareContext().env as HyperdriveEnv).HYPERDRIVE;
    if (!hyperdrive) throw new Error("HYPERDRIVE binding is missing (web/wrangler.jsonc)");
    return hyperdrive.connectionString;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see web/README.md)");
  return url;
}
