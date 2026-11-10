// Private preview gate (Kevin 2026-11-10): the whole site sits behind one password and is never indexed
// until Thierry gives his final go on the site. Lifting it = delete the middleware + this file + the secret.

export const GATE_USER = "dualis";
export const NOINDEX = "noindex, nofollow, noarchive";

/** True when the request's Basic Authorization header carries the preview password. */
export function isAuthorized(authorization: string | null, password: string): boolean {
  if (!password) throw new Error("SITE_PASSWORD is not set: the preview gate refuses to open without it");
  if (!authorization || !authorization.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authorization.slice(6).trim());
  } catch {
    return false; // malformed header from the client = not authorized, nothing to surface
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  return decoded.slice(0, sep) === GATE_USER && decoded.slice(sep + 1) === password;
}
