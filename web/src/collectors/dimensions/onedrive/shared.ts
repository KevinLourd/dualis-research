import { sql } from "drizzle-orm";
import * as gold from "@/db/schema/gold";
import { onedriveDocuments } from "@/db/schema/onedrive";
import type { Db } from "@/db/types";
import { accessToken, getConnection, MS_ENV } from "@/onedrive/auth";
import { Drive } from "@/onedrive/graph";
import type { TickerNames } from "@/onedrive/rules";
import { memo } from "../../markets";
import type { SourceContext } from "../../types";

export const ONEDRIVE_SOURCE = "onedrive";
export const DUALIS_SOURCE = "dualis";
export { MS_ENV };

/** The connected research root, or null while Thierry has not signed in and picked his folder. */
export async function connectedRoot(db: Db): Promise<{ itemId: string; path: string } | null> {
  const c = await getConnection(db);
  return c?.refreshToken && c.rootItemId ? { itemId: c.rootItemId, path: c.rootPath ?? "" } : null;
}

/** One Graph client per run (one token refresh). */
export function driveFor(ctx: SourceContext): Promise<Drive> {
  return memo(ctx, "onedrive-drive", async () => {
    if (!ctx.db) throw new Error("onedrive: the runner did not pass the database");
    return new Drive(await accessToken(ctx.db, ctx.env, ctx.fetch), ctx.fetch);
  });
}

/** Watchlist tickers with their resolved company name and aliases, for folder matching and naming. */
export async function tickerNames(db: Db): Promise<TickerNames[]> {
  const rows = await db
    .select({ symbol: gold.tickers.symbol, aliases: gold.tickers.aliases, name: gold.companyProfiles.name })
    .from(gold.tickers)
    .leftJoin(gold.companyProfiles, sql`${gold.companyProfiles.symbol} = ${gold.tickers.symbol}`);
  return rows.map((r) => ({ symbol: r.symbol, name: r.name ?? null, aliases: r.aliases }));
}

/** Union of two text arrays, for upserts that add a source tag or a bronze id. */
export const union = (column: string) => sql.raw(`array(select distinct unnest(${column} || excluded.${column.split(".").pop()}))`);

/**
 * gold.onedrive_documents = every file of a ticker's folder still there at its last full listing, plus the filings we
 * saved since. Rebuilt whole (one research folder, a few thousand rows at most).
 */
export async function rebuildGoldDocuments(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(onedriveDocuments);
    await tx.execute(sql`
      INSERT INTO gold.onedrive_documents (item_id, symbol, folder_name, path, name, kind, size, modified_at, web_url, excerpt, saved_by_dualis, sources)
      SELECT fi.item_id, fo.symbol, fo.name, fi.path, fi.name, fi.kind, fi.size, fi.modified_at, fi.web_url, fi.excerpt,
             ${DUALIS_SOURCE} = ANY(fi.sources), fi.sources
      FROM silver.onedrive_files fi
      JOIN silver.onedrive_folders fo ON fo.item_id = fi.folder_item_id
      WHERE fo.symbol IS NOT NULL AND (fo.listed_at IS NULL OR fi.last_seen_at >= fo.listed_at)`);
  });
}
