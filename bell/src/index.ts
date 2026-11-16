import { DurableObject } from "cloudflare:workers";
import { authorized, routeOf } from "./auth.ts";

/**
 * The WhatsApp doorbell (Kevin 2026-11-16: « il faut de l'immédiat pour WA »). The WhatsApp service keeps one WebSocket
 * open here; whoever queues a message in app.whatsapp_outbox POSTs /ring, and the service reads its outbox within a
 * second. The database (Neon free plan, 100 compute hours a month) keeps sleeping between messages.
 * Hibernation: an idle socket costs nothing, and the service's "ping" is answered without waking the object.
 */
type Env = { BELL: DurableObjectNamespace<Bell>; BELL_TOKEN: string };

export class Bell extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) ws.send("ring");
    return Response.json({ listeners: sockets.length });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname, request.headers.get("Upgrade"));
    if (!route) return new Response("not found", { status: 404 });
    if (!authorized(env.BELL_TOKEN, request.headers.get("Authorization"), url.searchParams.get("token"))) {
      return new Response("unauthorized", { status: 401 });
    }
    return env.BELL.get(env.BELL.idFromName("whatsapp")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
