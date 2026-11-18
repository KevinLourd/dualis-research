import { exchange, oauthErrorResponse } from "@/connector/oauth";

/** OAuth token endpoint of the connector: form-encoded (RFC 6749), JSON accepted too. */
export async function POST(req: Request): Promise<Response> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  const form = type.includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(text || "{}")).map(([k, v]) => [k, String(v)])) : new URLSearchParams(text);
  try {
    return Response.json(exchange(form), { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
