import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { onedriveConnection, onedriveDocuments, onedriveFolders } from "@/db/schema/onedrive";
import { CONNECTION_ID } from "@/onedrive/auth";

export type OnedriveStatus = {
  account: string | null;
  connected: boolean;
  rootPath: string | null;
  hasRoot: boolean;
  lastError: string | null;
  companyFolders: number;
  createdFolders: number;
  documents: number;
  savedFilings: number;
};

/** Settings > OneDrive: the connection without its secrets, and what we hold from his folder. */
export async function getOnedriveStatus(): Promise<OnedriveStatus> {
  const db = getDb();
  const [c] = await db.select().from(onedriveConnection).where(eq(onedriveConnection.id, CONNECTION_ID));
  const [folders] = await db
    .select({ all: sql<number>`count(*) filter (where ${onedriveFolders.symbol} is not null)::int`, created: sql<number>`count(*) filter (where ${onedriveFolders.matchedBy} = 'created')::int` })
    .from(onedriveFolders);
  const [docs] = await db
    .select({ all: sql<number>`count(*)::int`, saved: sql<number>`count(*) filter (where ${onedriveDocuments.savedByDualis})::int` })
    .from(onedriveDocuments);
  return {
    account: c?.account ?? null,
    connected: !!c?.refreshToken,
    rootPath: c?.rootPath ?? null,
    hasRoot: !!c?.rootItemId,
    lastError: c?.lastError ?? null,
    companyFolders: folders?.all ?? 0,
    createdFolders: folders?.created ?? 0,
    documents: docs?.all ?? 0,
    savedFilings: docs?.saved ?? 0,
  };
}
