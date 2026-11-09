import { writeFileSync } from "node:fs";
import { alertInput } from "../src/collectors/dimensions/signal-alerts/data";
import { alertPng } from "../src/collectors/dimensions/signal-alerts/render";
import { signalAlert } from "../src/content/messages";
import { connectNode } from "../src/db/node";
import { allowlist } from "../src/whatsapp/allowlist";
import { enqueue } from "../src/whatsapp/outbox";

/**
 * Test sends of the Signal Change alert (image + text) to Kevin's number only (the allowlist's "test" contact), never
 * Thierry. Each argument = `SYMBOL:FROM_SIGNAL/FROM_STRENGTH>TO_SIGNAL/TO_STRENGTH`, read on today's gold data.
 * `pnpm wa:signal-test 101160.KQ:none/noise>BUY/weak CCLD:BUY/weak>BUY/strong` (add `--out <dir>` to write the PNGs
 * instead of sending them).
 */
async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const outDir = outAt >= 0 ? args[outAt + 1] : null;
  const cases = args.filter((a, i) => a.includes(":") && i !== outAt + 1);
  const kevin = outDir ? null : allowlist().find((c) => c.role === "test");
  if (!outDir && !kevin) throw new Error("no test contact in the allowlist");
  const { db, close } = connectNode();
  try {
    for (const c of cases) {
      const m = c.match(/^([^:]+):(\w+)\/(\w+)>(\w+)\/(\w+)$/);
      if (!m) throw new Error(`bad case ${c}`);
      const [, symbol, fromSignal, fromStrength, toSignal, toStrength] = m;
      const input = await alertInput(db, { symbol, fromSignal, fromStrength, toSignal, toStrength });
      const png = alertPng(input);
      const text = signalAlert({ symbol, fromSignal, fromStrength, toSignal, toStrength, updateNote: "Test: the Update Note sits here." }, input.name);
      if (outDir) {
        writeFileSync(`${outDir}/${symbol}.png`, png);
        console.log(`[signal-alert-test] ${symbol}: ${png.length} bytes\n${text}\n`);
      } else {
        const row = await enqueue(db, { recipient: kevin!.phone, text: `TEST FORMAT\n${text}`, image: png, imageMime: "image/png", requestedBy: "test" });
        console.log(`[signal-alert-test] queued ${row.id} for ${symbol}`);
      }
    }
  } finally {
    await close();
  }
}

void main();
