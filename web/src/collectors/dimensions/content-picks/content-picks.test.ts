import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as content from "@/db/schema/content";
import { goldWhatsappConversation, whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { seedAnalysedTicker } from "@/test/content-seed";
import { testDb } from "@/test/db";
import { runDimension } from "../../runner";
import { contentDispatch } from "../content-dispatch";
import { contentDrafts } from "../content-drafts";
import { contentReplies } from "../content-replies";
import { contentPicks } from ".";

/** The post loop talks to Kevin while we test (POST_LOOP_ROLE "test"); fake numbers from vitest.config.ts. */
const KEVIN = "15550000002";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

let db: Db;
let close: () => Promise<void>;
let ideaA: string;
let ideaB: string;

async function addIdea(rank: number, title: string, scores: { format: string; score: number }[]) {
  const [idea] = await db
    .insert(content.contentIdeas)
    .values({ generationBronzeId: crypto.randomUUID(), rank, day: new Date().toISOString().slice(0, 10), symbol: "CCLD", title, angle: "a", sourceRefs: [], model: "fake", sources: ["claude"], bronzeIds: [] })
    .returning();
  const full = scores.map((s) => ({ ...s, why: "w" }));
  await db.insert(content.goldContentIdeas).values({ ...idea, companyName: "CareCloud", scores: full, bestFormat: full[0].format, bestScore: full[0].score, requests: [], draftCount: 0 });
  return idea.id;
}

/** A card as content-visuals stores it. */
const addCard = (ideaId: string, status: "ok" | "failed", kind: "montage" | "chart" = "montage") =>
  db.insert(content.contentVisuals).values({
    ideaId, kind, version: "v-test", status, error: status === "failed" ? "boom" : null, mime: status === "ok" ? "image/png" : null,
    file: status === "ok" ? PNG : null, sizeBytes: status === "ok" ? PNG.length : null, sources: ["render"], bronzeIds: [],
  });

/** The WhatsApp service on the box: sends queued rows and mirrors them in the conversation. */
async function serviceSends() {
  const queued = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.status, "queued"));
  for (const q of queued) {
    const waId = `OUT-${q.id.slice(0, 8)}`;
    await db.update(whatsappOutbox).set({ status: "sent", waMessageId: waId, sentAt: new Date() }).where(eq(whatsappOutbox.id, q.id));
    await db.insert(goldWhatsappConversation).values({ id: crypto.randomUUID(), waMessageId: waId, contact: q.recipient, contactName: "Kevin", direction: "out", kind: q.image ? "image" : "text", body: q.text, text: q.text, outboxId: q.id, sentAt: new Date(Date.now() - 60_000), sources: ["whatsapp"] });
  }
  return queued.map((q) => ({ ...q, waId: `OUT-${q.id.slice(0, 8)}` }));
}

async function kevinSays(body: string, replyTo: string) {
  const waId = `IN-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(goldWhatsappConversation).values({ id: crypto.randomUUID(), waMessageId: waId, contact: KEVIN, contactName: "Kevin", direction: "in", kind: "text", body, text: body, replyToWaId: replyTo, sentAt: new Date(), sources: ["whatsapp"] });
  return waId;
}

/** Fake Claude: the judge reads the intent from the reply, the writer drafts or shortens. */
const complete = vi.fn<Complete>(async ({ system, prompt }) => {
  if (system.startsWith("You judge")) {
    const said = prompt.split("Thierry: ").at(-1) ?? "";
    return { text: JSON.stringify({ verdict: /^go/i.test(said) ? "approve" : "change", probability: 0.9, cited_sentence: said }), model: "fake" };
  }
  if (prompt.includes("Thierry's feedback")) return { text: "$CCLD new hospital client. Shorter.", model: "fake" };
  if (system.includes("Format: one Substack Note")) return { text: "CareCloud signed a new hospital client.\n\nThe point: the lost client is replaced.", model: "fake" };
  return { text: "$CCLD signed a new hospital client, the one the market thinks it lost is replaced. Long read below.", model: "fake" };
});
const ctx = { env: { CLAUDE_OAUTH_TOKEN: "t" }, fetch, complete };
const run = (d: Parameters<typeof runDimension>[1]) => runDimension(db, d, { trigger: "test", ctx });

beforeEach(async () => {
  ({ db, close } = await testDb());
  complete.mockClear();
  await seedAnalysedTicker(db, "CCLD", { name: "CareCloud" });
  ideaA = await addIdea(1, "CareCloud replaced its lost client.", [{ format: "x-post", score: 90 }, { format: "substack-note", score: 80 }, { format: "substack-article", score: 99 }]);
  ideaB = await addIdea(2, "CareCloud margins turn.", [{ format: "substack-note", score: 70 }, { format: "x-post", score: 40 }]);
  await db.insert(whatsappLink).values({ id: "default", status: "linked" });
});
afterEach(async () => close());

describe("content-picks", () => {
  it("files the 2 posts of the day once: best X post and best Note, on two Ideas, never an article", async () => {
    await run(contentPicks);
    await run(contentPicks);
    const reqs = await db.select().from(content.contentDraftRequests);
    expect(reqs.map((r) => `${r.format}:${r.ideaId === ideaA ? "A" : "B"}`).sort()).toEqual(["substack-note:B", "x-post:A"]);
    expect(reqs.every((r) => r.sources.includes("auto"))).toBe(true);
  });

  it("skips a format whose best Idea scores under 50", async () => {
    await db.update(content.goldContentIdeas).set({ scores: [{ format: "x-post", score: 30, why: "w" }] });
    await run(contentPicks);
    expect(await db.select().from(content.contentDraftRequests)).toHaveLength(0);
  });
});

describe("the WhatsApp post loop, end to end on Kevin's number", () => {
  it("draft with its card arrives, « change: shorter » sends a new version, « go » hands the one-tap X link", async () => {
    await run(contentPicks);
    await run(contentDrafts);
    const drafts = await db.select().from(content.goldContentDrafts);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.scheduledAt)).toBe(true);

    // The cards are not drawn yet: nothing goes out, the drafts wait for them.
    await run(contentDispatch);
    expect(await db.select().from(whatsappOutbox)).toHaveLength(0);

    await addCard(ideaA, "ok");
    await addCard(ideaB, "ok"); // the Note waits for its chart, never the card
    await run(contentDispatch);
    expect(await serviceSends()).toHaveLength(1);
    await addCard(ideaB, "failed", "chart");
    await run(contentDispatch);
    await run(contentDispatch);
    await serviceSends();
    const sent = (await db.select().from(whatsappOutbox)).map((q) => ({ ...q, waId: q.waMessageId ?? "" }));
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.recipient === KEVIN)).toBe(true);
    const x = sent.find((s) => s.text?.includes("X post"))!;
    expect(x.imageMime).toBe("image/png");
    expect(Buffer.from(x.image!).equals(PNG)).toBe(true);
    expect(x.text).toContain("Reply go to post it");
    const note = sent.find((s) => s.text?.includes("Substack Note"))!;
    expect(Buffer.from(note.image!).equals(PNG)).toBe(true); // its chart failed: the card stands in

    // « change: shorter » on the X draft: version 2 comes back quoting him, with the same card.
    const change = await kevinSays("change: shorter", x.waId);
    await run(contentReplies);
    const v2 = (await db.select().from(whatsappOutbox)).find((o) => o.replyToWaId === change)!;
    expect(v2.text).toContain("Updated");
    expect(v2.text).toContain("Shorter.");
    expect(Buffer.from(v2.image!).equals(PNG)).toBe(true);
    expect(complete.mock.calls.at(-1)![0].prompt).toContain("change: shorter");

    // « go » on version 2: approved, the X post intent with the new text.
    const [v2Sent] = await serviceSends();
    const go = await kevinSays("go", v2Sent.waId);
    await run(contentReplies);
    const publish = (await db.select().from(whatsappOutbox)).find((o) => o.replyToWaId === go)!;
    expect(publish.recipient).toBe(KEVIN);
    expect(publish.text).toContain("https://x.com/intent/post?text=");
    expect(decodeURIComponent(publish.text!.split("text=")[1])).toContain("Shorter.");
    const approved = await db.select().from(content.goldContentDrafts).where(eq(content.goldContentDrafts.status, "approved"));
    expect(approved).toHaveLength(1);
    expect(approved[0].version).toBe(2);
  });
});
