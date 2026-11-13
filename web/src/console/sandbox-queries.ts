import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { goldSandboxAccounts, goldSandboxPosts, SANDBOX_FORMATS, type SandboxFormat, type SandboxPlatform } from "@/db/schema/sandbox";
import { goldXPublications, xConnections } from "@/db/schema/x";
import type { SandboxView } from "./sandbox-ui";

/** Sandbox pages: gold only, signal posts only (Kevin 2026-11-13: the other angles are gone) (an X account connected to the X API is live: its posts go out, `liveUrls`). A timeline reads its last 60 posts (12 days at 5 a day). */

export async function sandboxAccount(platform: SandboxPlatform, handle: string) {
  const db = getDb();
  const [account] = await db.select().from(goldSandboxAccounts).where(and(eq(goldSandboxAccounts.platform, platform), eq(goldSandboxAccounts.handle, handle)));
  if (!account) return null;
  const [posts, published, connection] = await Promise.all([
    db.select().from(goldSandboxPosts).where(and(eq(goldSandboxPosts.accountId, account.id), eq(goldSandboxPosts.angle, "signal"))).orderBy(desc(goldSandboxPosts.postAt), desc(goldSandboxPosts.slot)).limit(60),
    platform === "x" ? db.select().from(goldXPublications).where(and(eq(goldXPublications.accountId, account.id), eq(goldXPublications.status, "posted"))) : Promise.resolve([]),
    platform === "x" ? db.select({ handle: xConnections.handle }).from(xConnections).where(eq(xConnections.handle, account.handle.toLowerCase())) : Promise.resolve([]),
  ]);
  // A review round rewrites a day under new post ids: a live slot is matched on (day, slot).
  const liveUrls: Record<string, string> = Object.fromEntries(published.filter((p) => p.url).map((p) => [`${p.day}:${p.slot}`, p.url!]));
  return { account, posts, liveUrls, live: connection.length > 0 };
}

/** The page's filters from its search params; unknown values are ignored. */
export function sandboxView(q: Record<string, string | string[] | undefined>): SandboxView {
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const format = one("format");
  return {
    format: (SANDBOX_FORMATS as readonly string[]).includes(format ?? "") ? (format as SandboxFormat) : null,
    article: one("article"),
  };
}
