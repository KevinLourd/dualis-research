"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { withWriteDb } from "@/db/write";
import { accessToken, getConnection, type LoginPoll, pollDeviceLogin, setRoot, startDeviceLogin } from "@/onedrive/auth";
import { Drive } from "@/onedrive/graph";
import { onedriveConnection } from "@/db/schema/onedrive";

/**
 * Settings > OneDrive: Thierry signs in with a code (device login), then picks his research folder.
 * Every action needs a signed-in console user; tokens never leave the server.
 */

async function signedIn() {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to the console first");
}

export async function startOnedriveLogin(): Promise<{ userCode: string; verificationUri: string; expiresAt: string }> {
  await signedIn();
  const s = await withWriteDb((db) => startDeviceLogin(db, process.env, fetch));
  return { userCode: s.userCode, verificationUri: s.verificationUri, expiresAt: s.expiresAt.toISOString() };
}

export async function pollOnedriveLogin(): Promise<LoginPoll> {
  await signedIn();
  const r = await withWriteDb((db) => pollDeviceLogin(db, process.env, fetch));
  if (r.state !== "pending") revalidatePath("/settings");
  return r;
}

export type FolderEntry = { id: string; name: string; childCount: number };

/** The folders inside `parentId` (his drive root when null), for the picker. */
export async function listOnedriveFolders(parentId: string | null): Promise<{ parent: { id: string; name: string }; folders: FolderEntry[] }> {
  await signedIn();
  return withWriteDb(async (db) => {
    const drive = new Drive(await accessToken(db, process.env, fetch), fetch);
    const parent = parentId ? await drive.item(parentId) : await drive.root();
    const folders = (await drive.children(parent.id))
      .filter((c) => c.folder)
      .map((c) => ({ id: c.id, name: c.name, childCount: c.folder?.childCount ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { parent: { id: parent.id, name: parent.name }, folders };
  });
}

export async function chooseOnedriveRoot(itemId: string, path: string): Promise<void> {
  await signedIn();
  if (!itemId) throw new Error("No folder chosen");
  await withWriteDb(async (db) => {
    if (!(await getConnection(db))?.refreshToken) throw new Error("OneDrive is not connected");
    await setRoot(db, { itemId, path });
  });
  revalidatePath("/settings");
}

/** Forgets the sign-in on our side (his Microsoft account can also revoke it, see the email steps). */
export async function disconnectOnedrive(): Promise<void> {
  await signedIn();
  await withWriteDb((db) =>
    db
      .update(onedriveConnection)
      .set({ refreshToken: null, scope: null, account: null, connectedAt: null, rootItemId: null, rootPath: null, lastError: null, updatedAt: new Date() }),
  );
  revalidatePath("/settings");
}
