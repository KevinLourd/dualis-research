import { authorizationServerMetadata } from "@/connector/oauth";

/** RFC 8414 metadata of the connector's OAuth server (web/src/connector/oauth.ts). */
export function GET(): Response {
  return Response.json(authorizationServerMetadata(), { headers: { "access-control-allow-origin": "*" } });
}
