import { readFileSync } from "node:fs";
import { transcribe } from "./transcribe";

/** `pnpm transcribe note.ogg`: measures a transcription on a real file (time, memory). */
const file = process.argv[2];
if (!file) throw new Error("usage: pnpm transcribe <audio file>");
const before = process.memoryUsage().rss;
void transcribe(readFileSync(file)).then((t) => {
  console.log(JSON.stringify({ ...t, rssMb: Math.round(process.memoryUsage().rss / 1e6), rssBeforeMb: Math.round(before / 1e6) }, null, 2));
  process.exit(0);
});
