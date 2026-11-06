import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/types";
import { putPrivateFiles } from "@/private/files";

/** In-process Postgres with every migration applied. Tests only: the app and collectors use Neon. */
export async function testDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await putPrivateFiles(db as unknown as Db, fixturePrivateFiles());
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Fake stand-ins for Thierry's private files (src/test/fixtures/private), keyed on their path (`data/watchlist.json`). */
export function fixturePrivateFiles(): Record<string, string> {
  const root = fileURLToPath(new URL("./fixtures/private/", import.meta.url));
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
  return Object.fromEntries(files.map((d) => [relative(root, join(d.parentPath, d.name)), readFileSync(join(d.parentPath, d.name), "utf8")]));
}

/**
 * Tests exercise a dimension on the whole repo watchlist: lift the `analysis_scope` (data/watchlist.json fixture) that keeps
 * production runs on a few tickers.
 */
export async function analyseEveryTicker(db: Db): Promise<void> {
  const { tickers } = await import("@/db/schema/silver");
  await db.update(tickers).set({ analysed: true });
}
