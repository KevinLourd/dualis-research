/** The bell's only two routes: the WhatsApp service listens, any sender rings. Anything else is refused. */
export type Route = "listen" | "ring";

export function routeOf(method: string, pathname: string, upgrade: string | null): Route | null {
  if (method === "GET" && pathname === "/listen" && upgrade?.toLowerCase() === "websocket") return "listen";
  if (method === "POST" && pathname === "/ring") return "ring";
  return null;
}

/** Bearer header (ring) or ?token= (listen: WebSocket clients cannot always set headers). Constant-time compare. */
export function authorized(token: string | undefined, header: string | null, query: string | null): boolean {
  if (!token) return false;
  const given = header?.startsWith("Bearer ") ? header.slice(7) : query;
  if (!given || given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
