import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The OAuth server behind the Claude connector (Claude Desktop > Settings > Connectors > Add custom connector, URL
 * MCP_URL). Claude registers itself (RFC 7591, DCR), sends the person to /oauth/authorize, which needs a console
 * sign-in (Clerk, allowlisted emails only), and trades the code for tokens here. Nothing is stored: client ids, codes
 * and tokens are AES-GCM sealed JSON (key MCP_OAUTH_KEY), each with its kind and expiry, so a console deploy loses
 * nothing and a leaked database holds no token. A Clerk user removed from the console loses the connector at the next
 * call (route.ts checks the user on every request).
 * Requirements followed: https://claude.com/docs/connectors/building/authentication (401 + resource_metadata, S256
 * PKCE, form-encoded /token, invalid_grant, rotated refresh tokens, claude.ai callback + loopback on any port).
 */
export const CONSOLE_URL = (process.env.CONSOLE_URL ?? "https://console.dualisresearch.com").replace(/\/$/, "");
export const MCP_URL = `${CONSOLE_URL}/mcp`;
export const RESOURCE_METADATA_URL = `${CONSOLE_URL}/.well-known/oauth-protected-resource`;

const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 90 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;

export class OAuthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

type Kind = "client" | "code" | "access" | "refresh";
type Sealed = { k: Kind; exp?: number } & Record<string, unknown>;

function key(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.MCP_OAUTH_KEY;
  if (!raw) throw new Error("MCP_OAUTH_KEY is not set on the console: the Claude connector cannot sign tokens");
  return createHash("sha256").update(raw.trim()).digest();
}

const now = () => Math.floor(Date.now() / 1000);

export function seal(payload: Sealed, env?: Record<string, string | undefined>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** The sealed payload of `kind`, or null when it is forged, of another kind or expired. */
export function unseal<T extends Sealed>(token: string | null | undefined, kind: Kind, env?: Record<string, string | undefined>): T | null {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(env), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")) as T;
    if (payload.k !== kind) return null;
    if (payload.exp !== undefined && payload.exp < now()) return null;
    return payload;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("MCP_OAUTH_KEY")) throw e;
    return null;
  }
}

// ---- Discovery -------------------------------------------------------------------------------------------------

export function protectedResourceMetadata() {
  return { resource: MCP_URL, authorization_servers: [CONSOLE_URL], bearer_methods_supported: ["header"], resource_name: "Dualis Research" };
}

export function authorizationServerMetadata() {
  return {
    issuer: CONSOLE_URL,
    authorization_endpoint: `${CONSOLE_URL}/oauth/authorize`,
    token_endpoint: `${CONSOLE_URL}/oauth/token`,
    registration_endpoint: `${CONSOLE_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

// ---- Client registration (DCR) ---------------------------------------------------------------------------------

/** The hosted Claude apps' callback (claude.ai, Desktop, mobile; claude.com announced) and a loopback on any port (Claude Code). */
export function allowedRedirect(uri: string): boolean {
  if (uri === "https://claude.ai/api/mcp/auth_callback" || uri === "https://claude.com/api/mcp/auth_callback") return true;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** Same URI, or the same loopback URI on another port (RFC 8252 7.3). */
function sameRedirect(registered: string, asked: string): boolean {
  if (registered === asked) return true;
  try {
    const a = new URL(registered);
    const b = new URL(asked);
    const loop = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    return loop(a) && loop(b) && a.hostname === b.hostname && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

type Client = Sealed & { k: "client"; r: string[]; n: string };

export function registerClient(body: unknown) {
  const b = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === "string")) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be a non-empty list of URLs");
  }
  const refused = (uris as string[]).filter((u) => !allowedRedirect(u));
  if (refused.length) throw new OAuthError("invalid_redirect_uri", `Only Claude's callback URLs are accepted, not ${refused.join(", ")}`);
  const name = typeof b.client_name === "string" ? b.client_name.slice(0, 80) : "Claude";
  const client_id = seal({ k: "client", r: uris as string[], n: name });
  return {
    client_id,
    client_id_issued_at: now(),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

// ---- Authorization ---------------------------------------------------------------------------------------------

export type AuthorizeRequest = { clientId: string; clientName: string; redirectUri: string; codeChallenge: string; state: string | null };

/** Checks an /oauth/authorize request. Throws OAuthError when it cannot be answered by a redirect to the client. */
export function checkAuthorize(params: URLSearchParams | Record<string, string | undefined>): AuthorizeRequest {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params[k] ?? null));
  const client = unseal<Client>(get("client_id"), "client");
  if (!client) throw new OAuthError("invalid_client", "Unknown client: remove the connector in Claude and add it again");
  const redirectUri = get("redirect_uri") ?? (client.r.length === 1 ? client.r[0] : null);
  if (!redirectUri || !client.r.some((r) => sameRedirect(r, redirectUri))) throw new OAuthError("invalid_redirect_uri", "This redirect URI was not registered by the client");
  if (get("response_type") !== "code") throw new OAuthError("invalid_request", "response_type must be code");
  const codeChallenge = get("code_challenge");
  if (!codeChallenge || get("code_challenge_method") !== "S256") throw new OAuthError("invalid_request", "A PKCE S256 code_challenge is required");
  return { clientId: get("client_id")!, clientName: client.n, redirectUri, codeChallenge, state: get("state") };
}

/** The URL the person's browser goes back to once they allowed the connector, signed in as `userId`. */
export function approve(req: AuthorizeRequest, userId: string): string {
  const code = seal({ k: "code", exp: now() + CODE_SECONDS, c: req.clientId, r: req.redirectUri, p: req.codeChallenge, u: userId });
  const url = new URL(req.redirectUri);
  url.searchParams.set("code", code);
  if (req.state !== null) url.searchParams.set("state", req.state);
  url.searchParams.set("iss", CONSOLE_URL);
  return url.toString();
}

// ---- Tokens ----------------------------------------------------------------------------------------------------

function tokens(userId: string, clientId: string) {
  return {
    access_token: seal({ k: "access", exp: now() + ACCESS_SECONDS, u: userId }),
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: seal({ k: "refresh", exp: now() + REFRESH_SECONDS, u: userId, c: clientId }),
  };
}

/** /oauth/token: authorization_code (with the PKCE verifier) or refresh_token. Throws OAuthError. */
export function exchange(form: URLSearchParams) {
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = unseal<Sealed & { c: string; r: string; p: string; u: string }>(form.get("code"), "code");
    if (!code) throw new OAuthError("invalid_grant", "The code is invalid or expired");
    const clientId = form.get("client_id");
    if (clientId && clientId !== code.c) throw new OAuthError("invalid_grant", "The code was issued to another client");
    const redirect = form.get("redirect_uri");
    if (redirect && redirect !== code.r) throw new OAuthError("invalid_grant", "redirect_uri differs from the one used to authorize");
    const verifier = form.get("code_verifier");
    if (!verifier || createHash("sha256").update(verifier).digest("base64url") !== code.p) throw new OAuthError("invalid_grant", "PKCE verification failed");
    return tokens(code.u, code.c);
  }
  if (grant === "refresh_token") {
    const refresh = unseal<Sealed & { u: string; c: string }>(form.get("refresh_token"), "refresh");
    if (!refresh) throw new OAuthError("invalid_grant", "The refresh token is invalid or expired");
    return tokens(refresh.u, refresh.c);
  }
  throw new OAuthError("unsupported_grant_type", `grant_type ${grant} is not supported`);
}

/** The Clerk user id behind a bearer token, or null. */
export function bearerUser(authorization: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return unseal<Sealed & { u: string }>(m?.[1], "access")?.u ?? null;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to the Dualis console from Claude's connector settings" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${RESOURCE_METADATA_URL}"` },
  });
}

export function oauthErrorResponse(e: unknown): Response {
  if (!(e instanceof OAuthError)) throw e;
  return Response.json({ error: e.code, error_description: e.message }, { status: 400, headers: { "cache-control": "no-store" } });
}
