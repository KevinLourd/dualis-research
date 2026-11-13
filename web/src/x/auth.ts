import { eq } from "drizzle-orm";
import { xConnections } from "@/db/schema/x";
import type { Db } from "@/db/types";
import { open, seal } from "@/onedrive/auth";

/**
 * X API sign-in for our own X accounts (Kevin 2026-11-13): OAuth 2.0 with PKCE on Dualis's Developer Console app.
 * Each account authorized the app once (`tweet.read tweet.write users.read media.write offline.access`); its refresh
 * token lands here sealed, and X rotates it on every refresh (the old one dies), so the new one is saved BEFORE use.
 * A first token comes from the secret `X_REFRESH_TOKEN_<HANDLE>` (the connect script's output), read once while the
 * account has no row. Runs on Node and Workers (fetch + WebCrypto).
 */

export const X_ENV = ["X_CLIENT_ID", "X_CLIENT_SECRET", "X_TOKEN_KEY"] as const;
export const X_API = "https://api.x.com";
const SEED_PREFIX = "X_REFRESH_TOKEN_";

type Env = Record<string, string | undefined>;

function need(env: Env): { clientId: string; clientSecret: string; key: string } {
  const missing = X_ENV.filter((n) => !env[n]);
  if (missing.length) throw new Error(`X: missing env ${missing.join(", ")}`);
  return { clientId: env.X_CLIENT_ID!, clientSecret: env.X_CLIENT_SECRET!, key: env.X_TOKEN_KEY! };
}

/** Accounts with a stored token: the ones we publish to. */
export async function connectedHandles(db: Db): Promise<string[]> {
  const rows = await db.select({ handle: xConnections.handle }).from(xConnections);
  return rows.map((r) => r.handle);
}

/** Stores the token of every `X_REFRESH_TOKEN_<HANDLE>` secret whose account has no row yet. Returns the handles seeded. */
export async function seedConnections(db: Db, env: Env): Promise<string[]> {
  const seeds = Object.entries(env).filter(([k, v]) => k.startsWith(SEED_PREFIX) && v);
  if (seeds.length === 0) return [];
  const { key } = need(env);
  const known = new Set(await connectedHandles(db));
  const seeded: string[] = [];
  for (const [k, token] of seeds) {
    const handle = k.slice(SEED_PREFIX.length).toLowerCase();
    if (known.has(handle)) continue;
    await db.insert(xConnections).values({ handle, refreshToken: await seal(key, token!) });
    seeded.push(handle);
  }
  return seeded;
}

/** A fresh access token for `handle`; the rotated refresh token is saved first. Fails loud (revoked or expired). */
export async function xAccessToken(db: Db, env: Env, fetchFn: typeof fetch, handle: string, now = new Date()): Promise<string> {
  const { clientId, clientSecret, key } = need(env);
  const [row] = await db.select().from(xConnections).where(eq(xConnections.handle, handle));
  if (!row) throw new Error(`X: @${handle} is not connected`);
  const res = await fetchFn(`${X_API}/2/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: await open(key, row.refreshToken), client_id: clientId }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (res.status !== 200 || !body.access_token || !body.refresh_token) {
    const error = `X sign-in of @${handle} failed (${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim() + "): reconnect the account";
    await db.update(xConnections).set({ lastError: error, updatedAt: now }).where(eq(xConnections.handle, handle));
    throw new Error(error);
  }
  await db
    .update(xConnections)
    .set({ refreshToken: await seal(key, body.refresh_token), tokenRefreshedAt: now, lastError: null, updatedAt: now })
    .where(eq(xConnections.handle, handle));
  return body.access_token;
}
