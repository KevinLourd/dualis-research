import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { onedriveFiles, onedriveFolders } from "@/db/schema/onedrive";
import { filings } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { DriveItem } from "@/onedrive/graph";
import { extensionOf, FILINGS_FOLDER, filingFileName, isCoreFiling, isViewerPage, newFolderName, urlShortcut } from "@/onedrive/rules";
import { BROWSER_HEADERS, memo, SEC_HEADERS } from "../../markets";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { analysedSymbols } from "../watchlist";
import { connectedRoot, driveFor, DUALIS_SOURCE, MS_ENV, ONEDRIVE_SOURCE, rebuildGoldDocuments, tickerNames, union } from "../onedrive/shared";

/**
 * onedrive-filings (write-back): for every watchlist ticker, makes sure Thierry's research root has its company
 * folder (his own when one matches, else "<Name> (<TICKER>)"), a "Filings (Dualis)" subfolder in it, and saves every
 * core filing we collected (annual, semi-annual, quarterly reports, last 5 years) there.
 * Never deletes, never overwrites (a taken name is left as is and recorded), never writes outside "Filings (Dualis)"
 * except to create a missing company folder. Runs after `filings`.
 */

export const WRITE_SOURCE = "onedrive-write";
const YEARS = 5;
/** Uploads per ticker per run: the backlog drains over a few days without a long run. */
const MAX_UPLOADS_PER_RUN = 10;

type FolderResult = { item: DriveItem; created: boolean };
export type UploadResult = { filingId: string; name: string; created?: boolean; item?: DriveItem; error?: string };
export type WritePayload = { symbol: string; folder: FolderResult; filingsFolder: FolderResult; uploads: UploadResult[] };

async function companyFolder(db: Db, symbol: string): Promise<{ itemId: string } | null> {
  const [row] = await db
    .select({ itemId: onedriveFolders.itemId })
    .from(onedriveFolders)
    .where(eq(onedriveFolders.symbol, symbol))
    .orderBy(sql`${onedriveFolders.matchedBy} = 'created'`, desc(onedriveFolders.lastSeenAt))
    .limit(1);
  return row ?? null;
}

async function download(ctx: SourceContext, f: { registry: string; url: string }): Promise<{ bytes: Uint8Array; contentType: string; ext: string }> {
  if (isViewerPage(f.registry)) return { bytes: new TextEncoder().encode(urlShortcut(f.url)), contentType: "text/plain", ext: "url" };
  const headers = f.registry === "sec" ? SEC_HEADERS : { ...BROWSER_HEADERS, Accept: "*/*" };
  const res = await ctx.fetch(f.url, { headers });
  if (!res.ok) throw new Error(`download HTTP ${res.status} from ${f.url}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType, ext: extensionOf(contentType, f.url) };
}

async function writeBack(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
  const db = ctx.db!;
  const root = await connectedRoot(db);
  if (!root) return { request: { op: "write-back", symbol }, httpStatus: null, error: "OneDrive is not connected" };
  const drive = await driveFor(ctx);
  const names = await memo(ctx, "onedrive-ticker-names", () => tickerNames(db));
  const ticker = names.find((t) => t.symbol === symbol) ?? { symbol, name: null, aliases: [] };

  const known = await companyFolder(db, symbol);
  const folder: FolderResult = known ? { item: await drive.item(known.itemId), created: false } : await drive.ensureFolder(root.itemId, newFolderName(ticker));
  const filingsFolder = await drive.ensureFolder(folder.item.id, FILINGS_FOLDER);

  const since = new Date(Date.now() - YEARS * 365.25 * 86_400_000);
  const candidates = (
    await db
      .select({ id: filings.id, registry: filings.registry, form: filings.form, title: filings.title, filedAt: filings.filedAt, url: filings.url })
      .from(filings)
      .leftJoin(onedriveFiles, eq(onedriveFiles.filingId, filings.id))
      .where(and(eq(filings.symbol, symbol), gte(filings.filedAt, since), isNotNull(filings.url), isNull(onedriveFiles.itemId)))
      .orderBy(desc(filings.filedAt))
  )
    .filter(isCoreFiling)
    .slice(0, MAX_UPLOADS_PER_RUN);

  const uploads: UploadResult[] = [];
  for (const f of candidates) {
    let name = filingFileName(f, isViewerPage(f.registry) ? "url" : "pdf");
    try {
      const file = await download(ctx, { registry: f.registry, url: f.url! });
      name = filingFileName(f, file.ext);
      const { item, created } = await drive.uploadNew(filingsFolder.item.id, name, file.bytes, file.contentType);
      uploads.push({ filingId: f.id, name, created, item });
    } catch (err) {
      uploads.push({ filingId: f.id, name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const failed = uploads.filter((u) => u.error);
  return {
    request: { op: "write-back", symbol, rootItemId: root.itemId, filings: candidates.map((c) => c.id) },
    httpStatus: 200,
    payload: { symbol, folder, filingsFolder, uploads } satisfies WritePayload,
    ...(failed.length ? { error: `${failed.length} of ${uploads.length} filings not saved; first: ${failed[0].name}: ${failed[0].error}` } : {}),
  };
}

export const onedriveWrite: Source = {
  name: WRITE_SOURCE,
  requiredEnv: MS_ENV,
  covers: () => true,
  fetch: writeBack,
};

export const onedriveFilings: Dimension = {
  name: "onedrive-filings",
  description: "Saves every new core filing into the company's \"Filings (Dualis)\" folder in Thierry's OneDrive, creating the folders a ticker lacks.",
  sources: [onedriveWrite],
  subjects: async (db) => ((await connectedRoot(db)) ? analysedSymbols(db) : []),
  promote: promoteWrites,
};

/** What we wrote -> silver (created folders, saved filings, names already taken) -> gold.onedrive_documents. */
export async function promoteWrites(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const now = new Date();
  let rows = 0;
  for (const f of fetches.filter((x) => x.source === WRITE_SOURCE && x.payload)) {
    const p = f.payload as WritePayload;
    // A folder already in silver keeps its row; a new one is ours ("created") or one named after the ticker we found.
    const inserted = await db
      .insert(onedriveFolders)
      .values({
        itemId: p.folder.item.id,
        symbol: p.symbol,
        name: p.folder.item.name,
        webUrl: p.folder.item.webUrl ?? null,
        matchedBy: p.folder.created ? "created" : "symbol",
        sources: [p.folder.created ? DUALIS_SOURCE : ONEDRIVE_SOURCE],
        bronzeIds: [f.id],
        lastSeenAt: now,
      })
      .onConflictDoNothing()
      .returning({ itemId: onedriveFolders.itemId });
    rows += inserted.length;
    for (const u of p.uploads.filter((x) => x.item)) {
      const item = u.item!;
      // A name already taken: the file there (his or an earlier save of ours) stands for this filing, untouched.
      const sources = u.created ? [DUALIS_SOURCE] : [ONEDRIVE_SOURCE];
      await db
        .insert(onedriveFiles)
        .values({
          itemId: item.id,
          folderItemId: p.folder.item.id,
          symbol: p.symbol,
          name: item.name,
          path: `${FILINGS_FOLDER}/${item.name}`,
          kind: "filing",
          size: item.size ?? null,
          mimeType: item.file?.mimeType ?? null,
          modifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          webUrl: item.webUrl ?? null,
          filingId: u.filingId,
          sources,
          bronzeIds: [f.id],
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: onedriveFiles.itemId,
          set: { filingId: u.filingId, sources: union("silver.onedrive_files.sources"), bronzeIds: union("silver.onedrive_files.bronze_ids"), lastSeenAt: now },
        });
      rows += 1;
    }
  }
  await rebuildGoldDocuments(db);
  return { silverRowsBySource: { [WRITE_SOURCE]: rows } };
}
