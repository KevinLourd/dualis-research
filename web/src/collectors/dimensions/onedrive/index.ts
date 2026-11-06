import { inArray, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { onedriveFiles, onedriveFolders } from "@/db/schema/onedrive";
import type { Db } from "@/db/types";
import type { DriveItem } from "@/onedrive/graph";
import { documentKind, isReadableNote, matchFolder } from "@/onedrive/rules";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { connectedRoot, driveFor, MS_ENV, ONEDRIVE_SOURCE, rebuildGoldDocuments, tickerNames, union } from "./shared";

/**
 * onedrive (read): Thierry's research folder, one subfolder per company.
 * Round 0 lists the research root; round 1 lists every folder tied to a watchlist ticker (and every folder we
 * created), recursively. Bronze = each listing; silver = folders + files; gold = onedrive_documents.
 * Read-only: this dimension never writes to his drive (the write-back is `onedrive-filings`).
 */

const MAX_DEPTH = 4;
const MAX_FILES_PER_FOLDER = 1000;
const EXCERPT_CHARS = 4000;

export type ListedFile = DriveItem & { path: string; excerpt?: string };
type RootPayload = { rootItemId: string; children: DriveItem[] };
type FolderPayload = { folder: DriveItem; files: ListedFile[]; truncated: boolean };

async function list(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
  const drive = await driveFor(ctx);
  if (subject === "root") {
    const root = await connectedRoot(ctx.db!);
    if (!root) return { request: { op: "list-root" }, httpStatus: null, error: "OneDrive is not connected" };
    const children = await drive.children(root.itemId);
    return { request: { op: "list-root", itemId: root.itemId, path: root.path }, httpStatus: 200, payload: { rootItemId: root.itemId, children } satisfies RootPayload };
  }
  const id = subject.replace(/^folder:/, "");
  const folder = await drive.item(id);
  const files: ListedFile[] = [];
  let truncated = false;
  const walk = async (itemId: string, prefix: string, depth: number) => {
    for (const child of await drive.children(itemId)) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.folder) {
        if (depth < MAX_DEPTH) await walk(child.id, path, depth + 1);
        continue;
      }
      if (files.length >= MAX_FILES_PER_FOLDER) {
        truncated = true;
        return;
      }
      const excerpt = isReadableNote(child.name, child.size) ? (await drive.text(child.id)).slice(0, EXCERPT_CHARS) : undefined;
      files.push({ ...child, path, ...(excerpt !== undefined ? { excerpt } : {}) });
    }
  };
  await walk(id, "", 1);
  return { request: { op: "list-folder", itemId: id }, httpStatus: 200, payload: { folder, files, truncated } satisfies FolderPayload };
}

export const onedriveRead: Source = {
  name: ONEDRIVE_SOURCE,
  requiredEnv: MS_ENV,
  covers: () => true,
  fetch: list,
};

export const onedrive: Dimension = {
  name: "onedrive",
  description: "Thierry's research folder in OneDrive: one folder per company, his filings, models, transcripts and notes.",
  sources: [onedriveRead],
  subjects: async (db) => ((await connectedRoot(db)) ? ["root"] : []),
  async expand(db, fetchesSoFar, round) {
    if (round !== 1) return [];
    const rootFetch = fetchesSoFar.find((f) => f.subject === "root" && !f.error);
    if (!rootFetch) return [];
    const names = await tickerNames(db);
    const children = (rootFetch.payload as RootPayload).children.filter((c) => c.folder);
    const created = await db.select({ itemId: onedriveFolders.itemId }).from(onedriveFolders).where(sql`${onedriveFolders.matchedBy} = 'created'`);
    const createdIds = new Set(created.map((c) => c.itemId));
    return children.filter((c) => createdIds.has(c.id) || matchFolder(c.name, names)).map((c) => `folder:${c.id}`);
  },
  promote: promoteOnedrive,
};

/** bronze listings -> silver.onedrive_folders / onedrive_files -> gold.onedrive_documents. */
export async function promoteOnedrive(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error && f.source === ONEDRIVE_SOURCE);
  const now = new Date();
  let rows = 0;

  const rootFetch = ok.find((f) => f.subject === "root");
  if (rootFetch) {
    const names = await tickerNames(db);
    const children = (rootFetch.payload as RootPayload).children.filter((c) => c.folder);
    const existing = children.length
      ? await db.select().from(onedriveFolders).where(inArray(onedriveFolders.itemId, children.map((c) => c.id)))
      : [];
    const byId = new Map(existing.map((e) => [e.itemId, e]));
    for (const c of children) {
      const prior = byId.get(c.id);
      // A folder we created keeps its ticker even if he renames it; any other folder is re-matched on its name.
      const match = prior?.matchedBy === "created" ? { symbol: prior.symbol, matchedBy: "created" } : matchFolder(c.name, names);
      await db
        .insert(onedriveFolders)
        .values({ itemId: c.id, symbol: match?.symbol ?? null, name: c.name, webUrl: c.webUrl ?? null, matchedBy: match?.matchedBy ?? null, sources: [ONEDRIVE_SOURCE], bronzeIds: [rootFetch.id], lastSeenAt: now })
        .onConflictDoUpdate({
          target: onedriveFolders.itemId,
          set: { symbol: sql`excluded.symbol`, name: sql`excluded.name`, webUrl: sql`excluded.web_url`, matchedBy: sql`excluded.matched_by`, sources: union("silver.onedrive_folders.sources"), bronzeIds: union("silver.onedrive_folders.bronze_ids"), lastSeenAt: now },
        });
      rows += 1;
    }
  }

  for (const f of ok.filter((x) => x.subject.startsWith("folder:"))) {
    const p = f.payload as FolderPayload;
    const [folderRow] = await db.select().from(onedriveFolders).where(inArray(onedriveFolders.itemId, [p.folder.id]));
    for (const file of p.files) {
      await db
        .insert(onedriveFiles)
        .values({
          itemId: file.id,
          folderItemId: p.folder.id,
          symbol: folderRow?.symbol ?? null,
          name: file.name,
          path: file.path,
          kind: documentKind(file.path, file.name),
          size: file.size ?? null,
          mimeType: file.file?.mimeType ?? null,
          modifiedAt: file.lastModifiedDateTime ? new Date(file.lastModifiedDateTime) : null,
          webUrl: file.webUrl ?? null,
          excerpt: file.excerpt ?? null,
          sources: [ONEDRIVE_SOURCE],
          bronzeIds: [f.id],
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: onedriveFiles.itemId,
          set: {
            folderItemId: sql`excluded.folder_item_id`,
            symbol: sql`excluded.symbol`,
            name: sql`excluded.name`,
            path: sql`excluded.path`,
            kind: sql`excluded.kind`,
            size: sql`excluded.size`,
            mimeType: sql`excluded.mime_type`,
            modifiedAt: sql`excluded.modified_at`,
            webUrl: sql`excluded.web_url`,
            excerpt: sql`excluded.excerpt`,
            sources: union("silver.onedrive_files.sources"),
            bronzeIds: union("silver.onedrive_files.bronze_ids"),
            lastSeenAt: now,
          },
        });
      rows += 1;
    }
    // Listed in full: files not seen now have left the folder (truncated listings never retire anything).
    if (!p.truncated) await db.update(onedriveFolders).set({ listedAt: now }).where(inArray(onedriveFolders.itemId, [p.folder.id]));
  }

  await rebuildGoldDocuments(db);
  return { silverRowsBySource: { [ONEDRIVE_SOURCE]: rows } };
}
