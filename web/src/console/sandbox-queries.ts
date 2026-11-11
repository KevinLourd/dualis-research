import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { goldSandboxAccounts, goldSandboxPosts, type SandboxPlatform } from "@/db/schema/sandbox";

/** Sandbox pages (fake accounts, never published): gold only. A timeline reads its last 60 posts (12 days at 5 a day). */

const TONE_ORDER = { urgent: 0, balanced: 1, neutral: 2 } as const;

export const listSandboxAccounts = cache(async () => {
  const rows = await getDb().select().from(goldSandboxAccounts);
  return rows.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
});

export async function sandboxAccount(platform: SandboxPlatform, handle: string) {
  const db = getDb();
  const [account] = await db.select().from(goldSandboxAccounts).where(and(eq(goldSandboxAccounts.platform, platform), eq(goldSandboxAccounts.handle, handle)));
  if (!account) return null;
  const posts = await db.select().from(goldSandboxPosts).where(eq(goldSandboxPosts.accountId, account.id)).orderBy(desc(goldSandboxPosts.postAt), desc(goldSandboxPosts.slot)).limit(60);
  return { account, posts };
}
