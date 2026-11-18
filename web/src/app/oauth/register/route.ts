import { oauthErrorResponse, registerClient } from "@/connector/oauth";

/** RFC 7591 dynamic client registration: Claude registers itself when Thierry adds the connector. */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "The body must be JSON" }, { status: 400 });
  }
  try {
    return Response.json(registerClient(body), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return oauthErrorResponse(e);
  }
}
