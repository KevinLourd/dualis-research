import { afterEach, describe, expect, it, vi } from "vitest";
import { whatsappOutbox } from "../db/schema/whatsapp";
import { testDb } from "../test/db";
import { listenBell, ringBell } from "./bell";
import { enqueue } from "./outbox";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
}

afterEach(() => {
  FakeSocket.all = [];
  vi.useRealTimers();
});

describe("whatsapp bell", () => {
  it("rings with the token and reports how many services listen", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ listeners: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await ringBell("tok", fake, "https://bell.test")).toEqual({ rung: true, listeners: 1 });
    expect(calls[0].url).toBe("https://bell.test/ring");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("never throws: no token, a refusal or a network error is a reason", async () => {
    expect(await ringBell("", fetch)).toEqual({ rung: false, reason: "BELL_TOKEN is not set" });
    const refused = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect(await ringBell("tok", refused)).toEqual({ rung: false, reason: "bell answered 401" });
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await ringBell("tok", down)).toEqual({ rung: false, reason: "ECONNRESET" });
  });

  it("enqueue rings once the row is stored", async () => {
    const { db, close } = await testDb();
    let seen = -1;
    await enqueue(db, { recipient: "+1 555 000 0001", text: "hi", requestedBy: "test" }, async () => {
      seen = (await db.select().from(whatsappOutbox)).length;
      return { rung: true, listeners: 1 };
    });
    expect(seen).toBe(1);
    await close();
  });

  it("the service hears every ring, reads the outbox on connect, pings, and reconnects", () => {
    vi.useFakeTimers();
    const onRing = vi.fn();
    const bell = listenBell({ token: "a b", onRing, url: "https://bell.test", WebSocketImpl: FakeSocket, pingMs: 1_000, log: () => {} });
    const first = FakeSocket.all[0];
    expect(first.url).toBe("wss://bell.test/listen?token=a%20b");
    first.onopen?.();
    expect(onRing).toHaveBeenCalledTimes(1);
    first.onmessage?.({ data: "ring" });
    first.onmessage?.({ data: "pong" });
    expect(onRing).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(first.sent).toEqual(["ping"]);
    first.onclose?.();
    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.all).toHaveLength(2);
    bell.stop();
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
