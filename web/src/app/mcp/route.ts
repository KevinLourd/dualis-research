import { handleRpc } from "@/connector/mcp";
import { bearerUser, unauthorized } from "@/connector/oauth";
import { connectorUser } from "@/connector/user";

/** The Claude connector (https://console.dualisresearch.com/mcp): stateless MCP over Streamable HTTP, OAuth bearer. */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const userId = bearerUser(req.headers.get("authorization"));
  const user = userId ? await connectorUser(userId) : null;
  if (!user) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const out = await handleRpc(body, { author: user.name });
  if (out === null) return new Response(null, { status: 202 });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

/** No server-to-client stream: every answer comes back on the POST. */
export async function GET(req: Request): Promise<Response> {
  if (!bearerUser(req.headers.get("authorization"))) return unauthorized();
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}

export async function DELETE(): Promise<Response> {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}
