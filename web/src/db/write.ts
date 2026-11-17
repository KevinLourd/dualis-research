import { getDb } from "./client";
import type { Db } from "./types";

/** Console writes (Thierry's edits): the shared pool, transactions allowed (`db.transaction`). */
export async function withWriteDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return fn(getDb());
}
