import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetches } from "../db/schema/bronze";
import { goldWhatsappConversation, whatsappMessages, whatsappOutbox } from "../db/schema/whatsapp";
import type { Db } from "../db/types";
import { testDb } from "../test/db";
import { allowedContact, allowlist } from "./allowlist";
import { inboundEntry, receiptEntry } from "./inbound";
import { claimDue, enqueue, failInterrupted, processOutbox, type Sender, SIGNATURE } from "./outbox";
import { ingest } from "./store";

const THIERRY = "15550000001@s.whatsapp.net";
const KEVIN = "15550000002@s.whatsapp.net";

function textMessage(id: string, remoteJid: string, text: string, fromMe = false, extra: Record<string, unknown> = {}) {
  return { key: { id, remoteJid, fromMe, ...extra }, messageTimestamp: 1793000000, message: { conversation: text } };
}

function voiceMessage(id: string, remoteJid: string) {
  return {
    key: { id, remoteJid, fromMe: false },
    messageTimestamp: { low: 1793000100, high: 0, unsigned: true },
    message: { audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus", seconds: 4 } },
  };
}

function fakeSender(): Sender & { sent: { jid: string; text: string; quoted?: unknown; image?: unknown }[] } {
  const sent: { jid: string; text: string; quoted?: unknown; image?: unknown }[] = [];
  let n = 0;
  return {
    sent,
    async send(jid, m) {
      sent.push({ jid, text: m.text, quoted: m.quoted, image: m.image });
      n += 1;
      return { key: { id: `OUT${n}`, remoteJid: jid, fromMe: true }, messageTimestamp: 1793000200, message: { conversation: m.text } };
    },
  };
}

describe("whatsapp", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => ({ db, close } = await testDb()));
  afterEach(async () => close());

  it("allowlist matches phone and lid JIDs, never groups or strangers", () => {
    expect(allowedContact([THIERRY])?.name).toBe("Thierry");
    expect(allowedContact(["10000000000001@lid"])?.name).toBe("Thierry");
    expect(allowedContact(["15550000002:3@s.whatsapp.net"])?.name).toBe("Kevin");
    expect(allowedContact(["4412345678@s.whatsapp.net"])).toBeNull();
    expect(inboundEntry(textMessage("G1", "1203630@g.us", "hi", false, { participant: THIERRY }))).toBeNull();
    expect(inboundEntry(textMessage("S1", "4412345678@s.whatsapp.net", "hello Sophie"))).toBeNull();
    // A lid chat whose alternate JID is Thierry's phone.
    expect(inboundEntry(textMessage("L1", "999@lid", "hi", false, { remoteJidAlt: THIERRY }))?.contact.name).toBe("Thierry");
  });

  it("promotes an inbound message once per WhatsApp id, every bronze sighting kept", async () => {
    const e = inboundEntry(textMessage("A1", THIERRY, "Can you look at 4238.T?"))!;
    await ingest(db, [e.entry]);
    await ingest(db, [e.entry]); // the same message seen again (reconnect replay)
    const silver = await db.select().from(whatsappMessages);
    expect(silver).toHaveLength(1);
    expect(silver[0]).toMatchObject({ waMessageId: "A1", contact: "15550000001", direction: "in", kind: "text", text: "Can you look at 4238.T?" });
    expect(silver[0].bronzeIds).toHaveLength(2);
    expect(await db.select().from(fetches).where(eq(fetches.dimension, "whatsapp"))).toHaveLength(2);
    const gold = await db.select().from(goldWhatsappConversation);
    expect(gold).toHaveLength(1);
    expect(gold[0]).toMatchObject({ contactName: "Thierry", body: "Can you look at 4238.T?", direction: "in" });
  });

  it("attaches media and a whisper transcript to a voice note, transcript is the body", async () => {
    const v = inboundEntry(voiceMessage("V1", KEVIN))!;
    expect(v.isVoice).toBe(true);
    await ingest(db, [v.entry]);
    await ingest(db, [
      { source: "whatsapp", subject: "media:V1", request: { mime: "audio/ogg" }, payloadText: Buffer.from("ogg").toString("base64") },
      { source: "whisper", subject: "transcript:V1", request: { mime: "audio/ogg" }, payload: { text: " Hello, test note. ", model: "whisper-base" } },
    ]);
    const [m] = await db.select().from(whatsappMessages);
    expect(m).toMatchObject({ kind: "voice", transcript: "Hello, test note.", transcriptModel: "whisper-base" });
    expect(m.sources.sort()).toEqual(["whatsapp", "whisper"]);
    expect(m.mediaBronzeId).not.toBeNull();
    expect(m.sentAt.getTime()).toBe(1793000100 * 1000);
    const [g] = await db.select().from(goldWhatsappConversation);
    expect(g).toMatchObject({ body: "Hello, test note.", kind: "voice", contactName: "Kevin" });
  });

  it("sends a due outbox row signed, records it everywhere, and dedups the echo", async () => {
    const sender = fakeSender();
    const row = await enqueue(db, { recipient: "+1 555 000 0002", text: "Test from Dualis", requestedBy: "test" });
    const later = await enqueue(db, { recipient: "15550000002", text: "Later", requestedBy: "test", scheduledAt: new Date(Date.now() + 3600_000) });
    expect(await processOutbox(db, sender)).toBe(1);
    expect(sender.sent).toEqual([{ jid: KEVIN, text: `${SIGNATURE}\nTest from Dualis`, quoted: undefined, image: undefined }]);
    const [out] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, row.id));
    expect(out).toMatchObject({ status: "sent", waMessageId: "OUT1", attempts: 1 });
    expect(out.resultBronzeId).not.toBeNull();
    const [notYet] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, later.id));
    expect(notYet.status).toBe("queued");
    // The socket echoes our own message back, then receipts arrive.
    await ingest(db, [inboundEntry(textMessage("OUT1", KEVIN, `${SIGNATURE}\nTest from Dualis`, true))!.entry]);
    await ingest(db, [receiptEntry({ key: { id: "OUT1", remoteJid: KEVIN }, update: { status: 4 } })!]);
    await ingest(db, [receiptEntry({ key: { id: "OUT1", remoteJid: KEVIN }, update: { status: 3 } })!]); // late "delivered" never moves back
    const silver = await db.select().from(whatsappMessages);
    expect(silver).toHaveLength(1);
    expect(silver[0]).toMatchObject({ direction: "out", outboxId: row.id, delivery: "read" });
    const [g] = await db.select().from(goldWhatsappConversation);
    expect(g).toMatchObject({ direction: "out", delivery: "read", outboxId: row.id });
  });

  it("quotes the message it replies to, from bronze", async () => {
    await ingest(db, [inboundEntry(textMessage("Q1", KEVIN, "Draft please"))!.entry]);
    const sender = fakeSender();
    await enqueue(db, { recipient: "15550000002", text: "Here it is", replyToWaId: "Q1", requestedBy: "test" });
    await processOutbox(db, sender);
    expect((sender.sent[0].quoted as { key: { id: string } }).key.id).toBe("Q1");
  });

  it("refuses a recipient outside the allowlist without calling WhatsApp", async () => {
    const sender = fakeSender();
    const row = await enqueue(db, { recipient: "+44 1234 567890", text: "hi", requestedBy: "test" });
    await processOutbox(db, sender);
    expect(sender.sent).toHaveLength(0);
    const [out] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, row.id));
    expect(out.status).toBe("refused");
    expect(out.error).toContain("not on the WhatsApp allowlist");
    const [b] = await db.select().from(fetches).where(eq(fetches.id, out.resultBronzeId!));
    expect(b).toMatchObject({ subject: `send:${row.id}`, error: out.error });
    expect(await db.select().from(whatsappMessages)).toHaveLength(0);
  });

  it("retries a failed send, then gives up; a crash mid-send is failed, never re-sent", async () => {
    const broken: Sender = { send: async () => Promise.reject(new Error("socket closed")) };
    const row = await enqueue(db, { recipient: "15550000002", text: "x", requestedBy: "test" });
    const far = new Date(Date.now() + 10 * 60_000);
    for (let i = 0; i < 3; i++) await processOutbox(db, broken, far);
    const [out] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, row.id));
    expect(out).toMatchObject({ status: "failed", attempts: 3, error: "socket closed" });

    const stuck = await enqueue(db, { recipient: "15550000002", text: "y", requestedBy: "test" });
    expect(await claimDue(db, new Date())).toHaveLength(1); // claimed, then the process dies
    expect(await claimDue(db, new Date())).toHaveLength(0); // never claimed twice
    expect(await failInterrupted(db)).toBe(1);
    const [s] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, stuck.id));
    expect(s.status).toBe("failed");
  });
});

describe("allowlist secret", () => {
  it("fails loud when WHATSAPP_ALLOWLIST is missing or a contact is malformed", () => {
    expect(() => allowlist({})).toThrow(/WHATSAPP_ALLOWLIST is not set/);
    expect(() => allowlist({ WHATSAPP_ALLOWLIST: JSON.stringify([{ name: "X", phone: "+1 555", lids: [], role: "client" }]) })).toThrow(/bad contact/);
    expect(allowlist().map((c) => c.role)).toEqual(["client", "test"]);
  });
});
