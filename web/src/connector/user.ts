import { clerkClient } from "@clerk/nextjs/server";

/**
 * The console user behind a connector token, checked against Clerk (sign-in limited to the allowlisted emails): a user
 * removed from the console loses the connector within 5 minutes. Null = no such user any more.
 */
const cache = new Map<string, { at: number; name: string | null }>();

export async function connectorUser(userId: string): Promise<{ name: string } | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.name === null ? null : { name: hit.name };
  let name: string | null;
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    name = user.banned || user.locked ? null : user.firstName || "console user";
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    name = null;
  }
  cache.set(userId, { at: Date.now(), name });
  return name === null ? null : { name };
}
