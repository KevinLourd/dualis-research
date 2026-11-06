import { eq } from "drizzle-orm";
import { onedriveConnection, type OnedriveConnection } from "@/db/schema/onedrive";
import type { Db } from "@/db/types";

/**
 * Microsoft sign-in for Thierry's OneDrive: delegated device-code login on the Azure app already registered in his
 * Duality tenant (the one his stock digest used), started from Settings, so he only types a code and accepts.
 * Delegated `Files.ReadWrite` = his own files only, never the rest of the tenant, no admin consent, no app secret.
 * The refresh token is stored AES-GCM encrypted (ONEDRIVE_TOKEN_KEY) and rotated on every use.
 * Runs on Workers and Node (fetch + WebCrypto only).
 */

export const ONEDRIVE_SCOPE = "openid profile offline_access Files.ReadWrite";
export const CONNECTION_ID = "thierry";
export const MS_ENV = ["AZURE_CLIENT_ID", "AZURE_TENANT_ID", "ONEDRIVE_TOKEN_KEY"] as const;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

function need(env: Env): { clientId: string; tenantId: string; key: string } {
  const missing = MS_ENV.filter((n) => !env[n]);
  if (missing.length) throw new Error(`OneDrive: missing env ${missing.join(", ")}`);
  return { clientId: env.AZURE_CLIENT_ID!, tenantId: env.AZURE_TENANT_ID!, key: env.ONEDRIVE_TOKEN_KEY! };
}

const authority = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

// --- encryption (AES-256-GCM, key = 32 random bytes, base64) ---

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error("ONEDRIVE_TOKEN_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function open(keyB64: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("OneDrive: stored token has an unknown format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(keyB64), unb64(ct));
  return new TextDecoder().decode(plain);
}

// --- connection row ---

export async function getConnection(db: Db): Promise<OnedriveConnection | null> {
  const [row] = await db.select().from(onedriveConnection).where(eq(onedriveConnection.id, CONNECTION_ID));
  return row ?? null;
}

async function save(db: Db, values: Partial<typeof onedriveConnection.$inferInsert>): Promise<void> {
  const set = { ...values, updatedAt: new Date() };
  await db.insert(onedriveConnection).values({ id: CONNECTION_ID, ...set }).onConflictDoUpdate({ target: onedriveConnection.id, set });
}

async function postForm(fetchFn: Fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, string> }> {
  const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  const text = await res.text();
  let body: Record<string, string>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Microsoft sign-in answered HTTP ${res.status} without JSON: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

const describe = (body: Record<string, string>) => `${body.error}: ${(body.error_description ?? "").split("\r\n")[0]}`;

// --- device-code login (Settings) ---

export type LoginStart = { userCode: string; verificationUri: string; expiresAt: Date };

/** Asks Microsoft for a code Thierry types at microsoft.com/devicelogin; the device code stays server-side, sealed. */
export async function startDeviceLogin(db: Db, env: Env, fetchFn: Fetch, now = new Date()): Promise<LoginStart> {
  const { clientId, tenantId, key } = need(env);
  const { status, body } = await postForm(fetchFn, `${authority(tenantId)}/devicecode`, { client_id: clientId, scope: ONEDRIVE_SCOPE });
  if (status !== 200) throw new Error(`Microsoft refused to start the sign-in: ${describe(body)}`);
  const expiresAt = new Date(now.getTime() + Number(body.expires_in) * 1000);
  await save(db, {
    pendingDeviceCode: await seal(key, body.device_code),
    pendingUserCode: body.user_code,
    pendingVerificationUri: body.verification_uri,
    pendingExpiresAt: expiresAt,
  });
  return { userCode: body.user_code, verificationUri: body.verification_uri, expiresAt };
}

export type LoginPoll = { state: "idle" } | { state: "pending" } | { state: "connected"; account: string } | { state: "failed"; error: string };

const clearPending = { pendingDeviceCode: null, pendingUserCode: null, pendingVerificationUri: null, pendingExpiresAt: null };

/** One check of the pending login (the page calls it every few seconds). */
export async function pollDeviceLogin(db: Db, env: Env, fetchFn: Fetch, now = new Date()): Promise<LoginPoll> {
  const { clientId, tenantId, key } = need(env);
  const row = await getConnection(db);
  if (!row?.pendingDeviceCode) return { state: "idle" };
  if (row.pendingExpiresAt && row.pendingExpiresAt < now) {
    const error = "The code expired before the sign-in finished. Start again.";
    await save(db, { ...clearPending, lastError: error });
    return { state: "failed", error };
  }
  const { status, body } = await postForm(fetchFn, `${authority(tenantId)}/token`, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: clientId,
    device_code: await open(key, row.pendingDeviceCode),
  });
  if (status !== 200) {
    if (body.error === "authorization_pending" || body.error === "slow_down") return { state: "pending" };
    const error = `Sign-in failed: ${describe(body)}`;
    await save(db, { ...clearPending, lastError: error });
    return { state: "failed", error };
  }
  const account = accountOf(body.id_token) ?? "unknown account";
  await save(db, {
    ...clearPending,
    account,
    refreshToken: await seal(key, body.refresh_token),
    scope: body.scope,
    connectedAt: now,
    tokenRefreshedAt: now,
    lastError: null,
  });
  return { state: "connected", account };
}

function accountOf(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
  return json.preferred_username ?? json.email ?? json.upn ?? null;
}

// --- access token (collectors and console) ---

/** A fresh Graph access token from the stored refresh token; the rotated refresh token is saved. Fails loud. */
export async function accessToken(db: Db, env: Env, fetchFn: Fetch, now = new Date()): Promise<string> {
  const { clientId, tenantId, key } = need(env);
  const row = await getConnection(db);
  if (!row?.refreshToken) throw new Error("OneDrive is not connected: Thierry signs in from Settings > OneDrive");
  const { status, body } = await postForm(fetchFn, `${authority(tenantId)}/token`, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: await open(key, row.refreshToken),
    scope: ONEDRIVE_SCOPE,
  });
  if (status !== 200) {
    const error = `OneDrive sign-in expired or was revoked (${describe(body)}). Reconnect from Settings > OneDrive.`;
    await save(db, { lastError: error });
    throw new Error(error);
  }
  await save(db, {
    ...(body.refresh_token ? { refreshToken: await seal(key, body.refresh_token) } : {}),
    tokenRefreshedAt: now,
    lastError: null,
  });
  return body.access_token;
}

/** Thierry picked his research root (Settings). */
export async function setRoot(db: Db, root: { itemId: string; path: string }): Promise<void> {
  await save(db, { rootItemId: root.itemId, rootPath: root.path });
}
