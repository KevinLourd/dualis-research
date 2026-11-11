import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { goldSandboxAccounts, goldSandboxPosts, SANDBOX_ANGLES, SANDBOX_FORMATS, type SandboxAngle, type SandboxFormat, type SandboxPlatform } from "@/db/schema/sandbox";
import type { SandboxView } from "./sandbox-ui";

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

/** The page's filters from its search params; unknown values are ignored. */
export function sandboxView(q: Record<string, string | string[] | undefined>): SandboxView {
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const format = one("format");
  const angle = one("angle");
  return {
    format: (SANDBOX_FORMATS as readonly string[]).includes(format ?? "") ? (format as SandboxFormat) : null,
    angle: (SANDBOX_ANGLES as readonly string[]).includes(angle ?? "") ? (angle as SandboxAngle) : null,
    article: one("article"),
  };
}
