import { readFileSync } from "node:fs";
import { connectNode } from "../src/db/node";
import { allowlist } from "../src/whatsapp/allowlist";
import { enqueue } from "../src/whatsapp/outbox";

/**
 * Queues a test text + image for Kevin's number only (the allowlist's "test" contact), never Thierry.
 * The service sends them as soon as the device is linked. `pnpm wa:test`, or the "WhatsApp test" workflow.
 */
async function main() {
  const kevin = allowlist().find((c) => c.role === "test");
  if (!kevin) throw new Error("no test contact in the allowlist");
  const { db, close } = connectNode();
  try {
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    const text = await enqueue(db, { recipient: kevin.phone, text: `Test message from the Dualis WhatsApp service (${at} UTC). Reply with a voice note to test transcription.`, requestedBy: "test" });
    const image = await enqueue(db, {
      recipient: kevin.phone,
      text: "Test image: the Dualis mark.",
      image: readFileSync(new URL("../../wa/test-image.png", import.meta.url)),
      imageMime: "image/png",
      requestedBy: "test",
    });
    console.log(`[wa:test] queued ${text.id} (text) and ${image.id} (image) for ${kevin.name}`);
  } finally {
    await close();
  }
}

void main();
