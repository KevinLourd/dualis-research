import { asc, eq, like } from "drizzle-orm";
import { privateFiles } from "@/db/schema/app";
import type { Db } from "@/db/types";

/**
 * Thierry's private input files live in `app.private_files`, never in the public repo. A missing file fails loud,
 * by path: push it with `pnpm private:push <folder>`.
 */
export async function readPrivateFile(db: Db | undefined, path: string): Promise<string> {
  const text = await findPrivateFile(db, path);
  if (text === null) throw new Error(`${path} is not in app.private_files (pnpm private:push <folder>)`);
  return text;
}

/** The file's text, or null when it was never pushed (a ticker without a first-draft thesis). */
export async function findPrivateFile(db: Db | undefined, path: string): Promise<string | null> {
  if (!db) throw new Error(`reading ${path}: no database in the source context`);
  const [row] = await db.select({ content: privateFiles.content }).from(privateFiles).where(eq(privateFiles.path, path));
  return row?.content ?? null;
}

/** Paths under a folder (`data/outreach/`), sorted. */
export async function listPrivateFiles(db: Db | undefined, folder: string): Promise<string[]> {
  if (!db) throw new Error(`listing ${folder}: no database in the source context`);
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  const rows = await db
    .select({ path: privateFiles.path })
    .from(privateFiles)
    .where(like(privateFiles.path, `${prefix.replace(/[\\%_]/g, "\\$&")}%`))
    .orderBy(asc(privateFiles.path));
  return rows.map((r) => r.path);
}

/** Upserts files (path -> text). Used by `pnpm private:push` and the test database. */
export async function putPrivateFiles(db: Db, files: Record<string, string>): Promise<void> {
  const now = new Date();
  for (const [path, content] of Object.entries(files)) {
    await db.insert(privateFiles).values({ path, content, updatedAt: now }).onConflictDoUpdate({ target: privateFiles.path, set: { content, updatedAt: now } });
  }
}
