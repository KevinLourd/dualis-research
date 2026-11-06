import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useMultiFileAuthState } from "baileys";
import { sql } from "drizzle-orm";
import { whatsappAuth } from "../../web/src/db/schema/whatsapp";
import type { Db } from "../../web/src/db/types";

/**
 * Baileys keeps its session (creds + signal keys) in files on the container volume, rewritten on nearly every
 * message the number gets. Neon holds a SNAPSHOT of those files (app.whatsapp_auth), taken on link and then at
 * most once per idle tick, so the device survives a lost volume or a move to another host without waking the
 * free Neon compute on every key write. A fresh volume is restored from the snapshot before connecting.
 */
export async function openAuth(db: Db, dir: string) {
  await mkdir(dir, { recursive: true });
  const known = new Map<string, string>();
  if ((await readdir(dir)).length === 0) {
    const rows = await db.select().from(whatsappAuth);
    for (const r of rows) {
      const text = JSON.stringify(r.value);
      await writeFile(join(dir, r.key), text);
      known.set(r.key, text);
    }
    if (rows.length > 0) console.log(`[wa] auth restored from Neon (${rows.length} files)`);
  }
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  /** Writes the files that changed since the last snapshot; drops rows whose file is gone. */
  async function snapshot(): Promise<number> {
    const files = await readdir(dir);
    const changed: { key: string; value: unknown }[] = [];
    for (const f of files) {
      const text = await readFile(join(dir, f), "utf8");
      if (known.get(f) === text) continue;
      changed.push({ key: f, value: JSON.parse(text) });
      known.set(f, text);
    }
    for (let i = 0; i < changed.length; i += 100) {
      await db
        .insert(whatsappAuth)
        .values(changed.slice(i, i + 100))
        .onConflictDoUpdate({ target: whatsappAuth.key, set: { value: sql`excluded.value`, updatedAt: sql`now()` } });
    }
    const gone = [...known.keys()].filter((k) => !files.includes(k));
    for (const k of gone) {
      await db.delete(whatsappAuth).where(sql`${whatsappAuth.key} = ${k}`);
      known.delete(k);
    }
    return changed.length + gone.length;
  }

  /** After WhatsApp logged the device out: the session is dead everywhere, start a fresh pairing. */
  async function clear() {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await db.delete(whatsappAuth);
    known.clear();
  }

  return { state, saveCreds, snapshot, clear };
}
