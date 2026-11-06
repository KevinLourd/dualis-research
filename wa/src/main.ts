import makeWASocket, { BufferJSON, DisconnectReason, downloadMediaMessage, makeCacheableSignalKeyStore, type WAMessage, type WASocket } from "baileys";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import pino from "pino";
import postgres from "postgres";
import QRCode from "qrcode";
import { fetches } from "../../web/src/db/schema/bronze";
import { whatsappLink } from "../../web/src/db/schema/whatsapp";
import type { Db } from "../../web/src/db/types";
import { allowlist, jidUser, phoneJid } from "../../web/src/whatsapp/allowlist";
import { inboundEntry, receiptEntry } from "../../web/src/whatsapp/inbound";
import { failInterrupted, nextDueAt, processOutbox, type Sender } from "../../web/src/whatsapp/outbox";
import { type BronzeEntry, DIMENSION, ingest, SOURCE_WHATSAPP, SOURCE_WHISPER } from "../../web/src/whatsapp/store";
import { openAuth } from "./auth";
import { ON_IDLE_TICK, ON_INBOUND, runHosted } from "./hosted";
import { transcribe } from "./transcribe";

/**
 * Dualis's linked WhatsApp device. Neon free compute is billed while awake and sleeps after 5 idle minutes, so
 * the service touches the database only (a) when an allowlisted chat moves and (b) on an idle tick every
 * IDLE_TICK_MS (outbox poll + heartbeat + auth snapshot). After any allowlisted activity it polls the outbox every
 * ACTIVE_TICK_MS for ACTIVE_WINDOW_MS so a conversation feels live; a row scheduled later wakes it on time.
 */
const IDLE_TICK_MS = Number(process.env.IDLE_TICK_MS ?? 30 * 60_000);
const ACTIVE_TICK_MS = 10_000;
const ACTIVE_WINDOW_MS = 15 * 60_000;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
/** Thierry often sends several messages in a row: answer once they settle. */
const REPLY_DEBOUNCE_MS = 20_000;
const AUTH_DIR = process.env.AUTH_DIR ?? "/data/auth";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL is not set");
const client = postgres(url, { max: 1, idle_timeout: 60, onnotice: () => {} });
const db = drizzle(client) as unknown as Db;
const logger = pino({ level: process.env.BAILEYS_LOG ?? "warn" });

const toJson = <T>(x: T): Record<string, unknown> => JSON.parse(JSON.stringify(x, BufferJSON.replacer));
const fromJson = <T>(x: unknown): T => JSON.parse(JSON.stringify(x), BufferJSON.reviver);

/** Every DB write goes through one chain: events, sends and ticks never race on the same message id. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch((err) => console.error("[wa] task failed", err));
  return next;
}

let sock: WASocket | null = null;
let linked = false;
let authDirty = false;
let activeUntil = 0;
let tickTimer: NodeJS.Timeout | null = null;
let lastHeartbeat = 0;
let reconnectDelay = 2_000;
let replyTimer: NodeJS.Timeout | null = null;

/** Runs the inbound dimension once messages settle; a message during a run queues one more run after it. */
function requestReplies() {
  if (replyTimer) clearTimeout(replyTimer);
  replyTimer = setTimeout(() => {
    replyTimer = null;
    void serial(() => runHosted(db, ON_INBOUND, "whatsapp"));
  }, REPLY_DEBOUNCE_MS);
}
let auth: Awaited<ReturnType<typeof openAuth>>;

async function setLink(patch: Partial<typeof whatsappLink.$inferInsert> & { status: (typeof whatsappLink.$inferInsert)["status"] }) {
  const now = new Date();
  await db
    .insert(whatsappLink)
    .values({ id: "default", ...patch, lastSeenAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: whatsappLink.id, set: { ...patch, lastSeenAt: now, updatedAt: now } });
}

function bumpActive() {
  activeUntil = Date.now() + ACTIVE_WINDOW_MS;
  schedule(ACTIVE_TICK_MS);
}

async function handleMessage(msg: WAMessage) {
  const raw = toJson(msg);
  const hit = inboundEntry(raw);
  if (!hit) return;
  await ingest(db, [hit.entry]);
  bumpActive();
  // A message FROM the contact (not our own echo) gets the reply dimension, once its transcript is in (or failed).
  if ((hit.entry.request as { direction: string }).direction !== "in") return storeMedia(msg, hit);
  try {
    await storeMedia(msg, hit);
  } finally {
    requestReplies();
  }
}

async function storeMedia(msg: WAMessage, hit: NonNullable<ReturnType<typeof inboundEntry>>) {
  if (!hit.hasMedia) return;
  const id = msg.key.id as string;
  let media: Buffer;
  try {
    media = (await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock!.updateMediaMessage })) as Buffer;
    if (media.byteLength > MAX_MEDIA_BYTES) throw new Error(`media is ${media.byteLength} bytes, over the ${MAX_MEDIA_BYTES} kept`);
  } catch (err) {
    await ingest(db, [{ source: SOURCE_WHATSAPP, subject: `media:${id}`, request: {}, error: String(err) }]);
    return;
  }
  const mime = (msg.message?.audioMessage ?? msg.message?.imageMessage ?? msg.message?.videoMessage ?? msg.message?.documentMessage)?.mimetype ?? null;
  await ingest(db, [{ source: SOURCE_WHATSAPP, subject: `media:${id}`, request: { mime, bytes: media.byteLength }, payloadText: media.toString("base64") }]);
  if (!hit.isVoice) return;
  const entry: BronzeEntry = { source: SOURCE_WHISPER, subject: `transcript:${id}`, request: { mime, bytes: media.byteLength } };
  try {
    const t = await transcribe(media);
    console.log(`[wa] transcribed ${t.audioSeconds}s note in ${t.durationMs}ms`);
    await ingest(db, [{ ...entry, payload: t }]);
  } catch (err) {
    await ingest(db, [{ ...entry, error: err instanceof Error ? err.message : String(err) }]);
  }
}

const sender: Sender = {
  async send(jid, m) {
    if (!sock || !linked) throw new Error("WhatsApp device is not linked");
    const content = m.image
      ? { image: m.image, caption: m.text, ...(m.imageMime ? { mimetype: m.imageMime } : {}) }
      : { text: m.text };
    const sent = await sock.sendMessage(jid, content, m.quoted ? { quoted: fromJson<WAMessage>(m.quoted) } : undefined);
    if (!sent) throw new Error("WhatsApp returned nothing for the send");
    return toJson(sent) as Awaited<ReturnType<Sender["send"]>>;
  },
};

async function tick() {
  const now = Date.now();
  if (linked) {
    const handled = await serial(() => processOutbox(db, sender));
    if (handled > 0) bumpActive();
  }
  if (now - lastHeartbeat >= IDLE_TICK_MS - 1_000) {
    lastHeartbeat = now;
    await serial(async () => {
      await db.update(whatsappLink).set({ lastSeenAt: new Date() }).where(eq(whatsappLink.id, "default"));
      if (authDirty) {
        authDirty = false;
        await auth.snapshot();
      }
    });
    await serial(() => runHosted(db, ON_IDLE_TICK, "service"));
  }
  const due = await nextDueAt(db);
  const base = Date.now() < activeUntil ? ACTIVE_TICK_MS : IDLE_TICK_MS;
  schedule(due ? Math.max(1_000, Math.min(base, due.getTime() - Date.now())) : base);
}

function schedule(ms: number) {
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = setTimeout(() => tick().catch((err) => (console.error("[wa] tick failed", err), schedule(60_000))), ms);
}

/** Learns the lid (privacy id) behind each allowlisted phone, so chats WhatsApp addresses by lid still match. */
async function learnLids(s: WASocket) {
  for (const c of allowlist()) {
    const lid = await s.signalRepository.lidMapping.getLIDForPN(phoneJid(c.phone)).catch(() => null);
    if (lid && !c.lids.includes(jidUser(lid))) c.lids.push(jidUser(lid));
  }
}

async function getMessage(key: { id?: string | null }) {
  const [row] = await db
    .select({ subject: fetches.subject, payload: fetches.payload })
    .from(fetches)
    .where(and(eq(fetches.dimension, DIMENSION), sql`(${fetches.subject} = ${`message:${key.id}`} or ${fetches.payload}->>'waMessageId' = ${key.id ?? ""})`))
    .orderBy(desc(fetches.fetchedAt))
    .limit(1);
  if (!row) return undefined;
  const raw = row.subject.startsWith("send:") ? (row.payload as { message: unknown }).message : row.payload;
  return fromJson<WAMessage>(raw).message ?? undefined;
}

function start() {
  const s = makeWASocket({
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    logger,
    browser: ["Dualis Research", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage,
  });
  sock = s;
  s.ev.on("creds.update", async () => {
    await auth.saveCreds();
    authDirty = true;
  });
  s.ev.on("connection.update", (u) => {
    if (u.qr) {
      const qr = u.qr;
      void serial(async () => {
        console.log(`[wa] not linked: scan this code from the phone (WhatsApp > Linked devices > Link a device)\n${await QRCode.toString(qr, { type: "terminal", small: true })}`);
        await setLink({ status: "waiting-for-scan", qrSvg: await QRCode.toString(qr, { type: "svg", margin: 1 }), error: null });
      });
    }
    if (u.connection === "open") {
      linked = true;
      reconnectDelay = 2_000;
      const phone = s.user?.id ? jidUser(s.user.id) : null;
      console.log(`[wa] linked to ${phone}`);
      void serial(async () => {
        await setLink({ status: "linked", qrSvg: null, phone, error: null });
        await auth.snapshot();
        authDirty = false;
        await learnLids(s);
      });
      schedule(1_000);
    }
    if (u.connection === "close") {
      linked = false;
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const reason = u.lastDisconnect?.error?.message ?? "connection closed";
      if (code === DisconnectReason.loggedOut) {
        console.warn("[wa] logged out from the phone; starting a fresh pairing");
        void serial(async () => {
          await auth.clear();
          await setLink({ status: "logged-out", qrSvg: null, error: "This device was removed from the phone. Scan the new code to link it again." });
        });
        // Fresh pairing needs fresh creds: restart the process (docker restarts it) after the clear lands.
        void chain.then(() => process.exit(0));
        return;
      }
      console.warn(`[wa] connection closed (${code ?? "?"}: ${reason}), reconnecting in ${reconnectDelay / 1000}s`);
      setTimeout(start, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    }
  });
  s.ev.on("messages.upsert", ({ messages }) => {
    for (const m of messages) void serial(() => handleMessage(m));
  });
  s.ev.on("messages.update", (updates) => {
    const entries = updates.map((u) => receiptEntry(toJson(u))).filter((e): e is BronzeEntry => e !== null);
    if (entries.length > 0) void serial(() => ingest(db, entries));
  });
}

async function shutdown(signal: string) {
  console.log(`[wa] ${signal}: saving session snapshot`);
  if (tickTimer) clearTimeout(tickTimer);
  await chain;
  await auth.snapshot().catch((err) => console.error("[wa] snapshot failed", err));
  sock?.end(undefined);
  await client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main() {
  auth = await openAuth(db, AUTH_DIR);
  const interrupted = await failInterrupted(db);
  if (interrupted > 0) console.warn(`[wa] ${interrupted} outbox row(s) were mid-send at the last stop: marked failed, not re-sent`);
  await setLink({ status: "starting" });
  start();
  // First tick a minute after boot: deploys restart the container more often than the idle interval fires.
  schedule(60_000);
}

main().catch((err) => {
  console.error("[wa] boot failed", err);
  process.exit(1);
});
