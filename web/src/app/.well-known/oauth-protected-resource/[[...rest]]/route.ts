import { protectedResourceMetadata } from "@/connector/oauth";

/** RFC 9728 metadata of the Claude connector, at /.well-known/oauth-protected-resource and .../mcp. */
export function GET(): Response {
  return Response.json(protectedResourceMetadata(), { headers: { "access-control-allow-origin": "*" } });
}
