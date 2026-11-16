/**
 * The WhatsApp doorbell (Kevin 2026-11-16: « une file d'attente pour WA n'a aucun sens, il faut de l'immédiat »).
 * The WhatsApp service keeps a WebSocket open on the dualis-bell Worker (bell/); queueing a message rings it, and the
 * service reads app.whatsapp_outbox at once. Without the bell the service still reads it on its idle tick (30 min).
 */
export const BELL_URL = "https://dualis-bell.dualis-research.workers.dev";

export type RingResult = { rung: true; listeners: number } | { rung: false; reason: string };

/** Rings the bell. Never throws: the row is already queued, the idle tick stays the backstop; the reason is logged. */
export async function ringBell(
  token = process.env.BELL_TOKEN,
  fetchImpl: typeof fetch = fetch,
  url = process.env.BELL_URL ?? BELL_URL,
): Promise<RingResult> {
  if (!token) return { rung: false, reason: "BELL_TOKEN is not set" };
  try {
    const res = await fetchImpl(`${url}/ring`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { rung: false, reason: `bell answered ${res.status}` };
    const { listeners } = (await res.json()) as { listeners: number };
    return { rung: true, listeners };
  } catch (err) {
    return { rung: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type Socket = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
};

export type BellOptions = {
  token: string;
  onRing: () => void;
  url?: string;
  WebSocketImpl?: new (url: string) => Socket;
  pingMs?: number;
  log?: (line: string) => void;
};

/** Keeps a WebSocket open on the bell, calls onRing on every ring, pings every 30 s, reconnects (2 s doubling to 60 s). */
export function listenBell(o: BellOptions): { stop: () => void } {
  const WS = o.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => Socket);
  const wsUrl = `${(o.url ?? BELL_URL).replace(/^http/, "ws")}/listen?token=${encodeURIComponent(o.token)}`;
  const log = o.log ?? ((line: string) => console.log(`[wa] ${line}`));
  let delay = 2_000;
  let stopped = false;
  let ws: Socket | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    ws = new WS(wsUrl);
    ws.onopen = () => {
      delay = 2_000;
      log("bell connected");
      ping = setInterval(() => ws?.send("ping"), o.pingMs ?? 30_000);
      // A message queued while the socket was down rang nobody: read the outbox now.
      o.onRing();
    };
    ws.onmessage = (e) => {
      if (e.data === "ring") o.onRing();
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (ping) clearInterval(ping);
      ping = null;
      ws = null;
      if (stopped) return;
      log(`bell closed, reconnecting in ${delay / 1000}s`);
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000);
    };
  };
  connect();
  return {
    stop() {
      stopped = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}
