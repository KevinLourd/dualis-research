import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signalChanges } from "@/db/schema/analysis";
import * as content from "@/db/schema/content";
import { goldWhatsappConversation, whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentDispatch } from "../content-dispatch";
import { rebuildGoldDrafts } from "../content-drafts";
import { contentReplies } from ".";

const THIERRY = "15550000001";
/** The post loop talks to Kevin while we test (POST_LOOP_ROLE "test"). */
const KEVIN = "15550000002";

let db: Db;
let close: () => Promise<void>;
let draftId: string;

/** A draft as content-drafts writes it, slot in `slotMin` minutes. */
async function addDraft(db: Db, slotMin: number, format: "x-post" | "linkedin-post" = "x-post") {
  const [d] = await db
    .insert(content.contentDrafts)
    .values({
      generationBronzeId: crypto.randomUUID(),
      symbol: "BOOT",
      inputKey: `cat-${crypto.randomUUID()}`,
      format,
      accountId: "x:quantum_macro",
      version: 1,
      title: null,
      body: "$BOOT margin rose 190 bps (8-K).",
      inputs: { symbol: "BOOT", companyName: "Boot Barn", news: null, worthJudgmentId: null, worth: null, thesis: null, driver: null, chart: null },
      scheduledAt: new Date(Date.now() + slotMin * 60_000),
      model: "fake",
      sources: ["claude"],
      bronzeIds: [crypto.randomUUID()],
    })
    .returning();
  await rebuildGoldDrafts(db);
  return d.id;
}

const link = (status: "linked" | "waiting-for-scan") => db.insert(whatsappLink).values({ id: "default", status }).onConflictDoUpdate({ target: whatsappLink.id, set: { status } });

/** The WhatsApp service: marks queued rows sent and mirrors them in the conversation. */
async function serviceSends() {
  const queued = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.status, "queued"));
  for (const q of queued) {
    const waId = `OUT-${q.id.slice(0, 6)}`;
    await db.update(whatsappOutbox).set({ status: "sent", waMessageId: waId, sentAt: new Date() }).where(eq(whatsappOutbox.id, q.id));
    await db.insert(goldWhatsappConversation).values({ id: crypto.randomUUID(), waMessageId: waId, contact: q.recipient, contactName: "Kevin", direction: "out", kind: "text", body: q.text, text: q.text, outboxId: q.id, sentAt: new Date(Date.now() - 60_000), sources: ["whatsapp"] });
  }
  return queued;
}

async function thierrySays(body: string, replyTo: string | null, waId = `IN-${crypto.randomUUID().slice(0, 6)}`) {
  await db.insert(goldWhatsappConversation).values({ id: crypto.randomUUID(), waMessageId: waId, contact: KEVIN, contactName: "Kevin", direction: "in", kind: "text", body, text: body, replyToWaId: replyTo, sentAt: new Date(), sources: ["whatsapp"] });
  return waId;
}

function fakeComplete(intent: string) {
  return vi.fn<Complete>(async ({ system }) => {
    if (system.startsWith("You judge")) return { text: JSON.stringify({ verdict: intent, probability: 0.9, cited_sentence: "x" }), model: "fake" };
    return { text: "$BOOT margin rose 190 bps (8-K, 2026-10-28). Shorter now.", model: "fake" };
  });
}
const ctx = (complete: Complete) => ({ env: {}, fetch, complete });

beforeEach(async () => {
  ({ db, close } = await testDb());
  await db.insert(content.contentAccounts).values({ id: "x:quantum_macro", channel: "x", owner: "thierry", name: "@quantum_macro", url: "https://x.com/quantum_macro", handle: "quantum_macro", samples: [], sources: ["repo"], bronzeIds: [] });
  draftId = await addDraft(db, 10);
});
afterEach(async () => close());

describe("content-dispatch", () => {
  it("queues nothing while the WhatsApp device is not linked", async () => {
    await link("waiting-for-scan");
    await runDimension(db, contentDispatch, { trigger: "test", ctx: ctx(fakeComplete("other")) });
    expect(await db.select().from(whatsappOutbox)).toHaveLength(0);
  });

  it("queues each draft once at its slot, skips slots too far ahead or long missed", async () => {
    await link("linked");
    await addDraft(db, 120); // too far ahead: next run
    await addDraft(db, -800); // missed by 13 hours: skipped
    await runDimension(db, contentDispatch, { trigger: "test", ctx: ctx(fakeComplete("other")) });
    await runDimension(db, contentDispatch, { trigger: "test", ctx: ctx(fakeComplete("other")) });
    const out = await db.select().from(whatsappOutbox);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ recipient: KEVIN, requestedBy: "content-dispatch" });
    expect(out[0].text).toContain("$BOOT margin rose 190 bps");
    expect(out[0].text).toContain("Reply go to post it");
    expect(out[0].scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("a Signal Change is the alert (one engine); one older than a day and never sent is the baseline, no message", async () => {
    await link("linked");
    const base = { fromSignal: "none" as const, fromStrength: "noise" as const, evidenceIds: [] };
    await db.insert(signalChanges).values([
      { id: crypto.randomUUID(), symbol: "MNRO", toSignal: "BUY", toStrength: "weak", at: new Date(Date.now() - 3 * 86400_000), updateNote: "old", ...base },
      { id: crypto.randomUUID(), symbol: "PAL", toSignal: "SELL", toStrength: "strong", at: new Date(), updateNote: "Orders slowed.", ...base },
    ]);
    await runDimension(db, contentDispatch, { trigger: "test", ctx: ctx(fakeComplete("other")) });
    const alerts = (await db.select().from(whatsappOutbox)).filter((o) => o.text?.includes("was no signal"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].recipient).toBe(THIERRY);
    expect(alerts[0].text).toContain("*PAL*: SELL (strong crack), was no signal.");
    expect(alerts[0].text).toContain("Orders slowed.");
    expect(alerts[0].text).toContain("/tickers/PAL");
    expect((await db.select().from(content.contentMessages)).map((m) => m.purpose).sort()).toEqual(["alert", "baseline", "draft"]);
  });
});

describe("content-replies", () => {
  async function sendDraft() {
    await link("linked");
    await runDimension(db, contentDispatch, { trigger: "test", ctx: ctx(fakeComplete("other")) });
    const [sent] = await serviceSends();
    return `OUT-${sent.id.slice(0, 6)}`;
  }

  it("a change request rewrites the draft as a new version and sends it back, quoting him", async () => {
    const quoted = await sendDraft();
    const waId = await thierrySays("Shorter, and add the date of the 8-K", quoted);
    const complete = fakeComplete("change");
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(complete) });
    const versions = await db.select().from(content.contentDrafts).where(eq(content.contentDrafts.symbol, "BOOT"));
    const v2 = versions.find((v) => v.version === 2)!;
    expect(v2.body).toContain("2026-10-28");
    expect(v2.sources).toEqual(["claude", "whatsapp"]);
    const reply = (await db.select().from(whatsappOutbox)).find((o) => o.replyToWaId === waId)!;
    expect(reply.text).toContain("Updated");
    // The prompt carried his feedback and the current draft.
    expect(complete.mock.calls.at(-1)![0].prompt).toContain("Shorter, and add the date");

    // Handled once: a re-run (service restart) asks and sends nothing more.
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(complete) });
    expect(complete).toHaveBeenCalledTimes(2);
    expect((await db.select().from(whatsappOutbox)).filter((o) => o.replyToWaId === waId)).toHaveLength(1);

    // His next feedback on the new version builds version 3.
    await serviceSends();
    const v2Msg = (await db.select().from(goldWhatsappConversation)).find((m) => m.direction === "out" && m.text?.startsWith("Updated"))!;
    await thierrySays("Even shorter", v2Msg.waMessageId);
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(complete) });
    expect((await db.select().from(content.contentDrafts)).map((d) => d.version).sort()).toEqual([1, 2, 3]);
  });

  it("OK approves it and sends the one-click X link; 'drop it' dismisses", async () => {
    const quoted = await sendDraft();
    await thierrySays("OK go", quoted);
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(fakeComplete("approve")) });
    const [g] = await db.select().from(content.goldContentDrafts).where(eq(content.goldContentDrafts.id, draftId));
    expect(g.status).toBe("approved");
    const publish = (await db.select().from(whatsappOutbox)).find((o) => o.text?.startsWith("Approved"))!;
    expect(publish.text).toContain("https://x.com/intent/post?text=");

    // Not a quote: it answers the latest draft sent to him in the last hours.
    await thierrySays("drop this one", null);
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(fakeComplete("dismiss")) });
    const replies = await db.select().from(content.contentReplies);
    expect(replies.map((r) => r.intent).sort()).toEqual(["approve", "dismiss"]);
  });

  it("a message about no draft is recorded and left unanswered (no judgment, no send)", async () => {
    await thierrySays("Call me later", null);
    const complete = fakeComplete("other");
    await runDimension(db, contentReplies, { trigger: "whatsapp", ctx: ctx(complete) });
    expect(complete).not.toHaveBeenCalled();
    expect((await db.select().from(content.contentReplies))[0].intent).toBe("no-draft");
    expect(await db.select().from(whatsappOutbox)).toHaveLength(0);
  });
});
