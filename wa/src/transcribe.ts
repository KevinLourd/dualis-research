import { spawn } from "node:child_process";

/**
 * Voice notes -> text at $0, on the box CPU: ffmpeg decodes the Opus note to 16 kHz mono PCM, Whisper (ONNX, via
 * transformers.js) transcribes it. The model loads on the first note and is dropped after IDLE_UNLOAD_MS so it
 * does not hold memory on a shared box between conversations.
 */
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "onnx-community/whisper-base";
const IDLE_UNLOAD_MS = 10 * 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: Promise<any> | null = null;
let unloadTimer: NodeJS.Timeout | null = null;

async function model() {
  if (!pipe) {
    pipe = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      if (process.env.MODELS_DIR) env.cacheDir = process.env.MODELS_DIR;
      return pipeline("automatic-speech-recognition", WHISPER_MODEL, { dtype: "q8" });
    })();
    pipe.catch(() => (pipe = null));
  }
  if (unloadTimer) clearTimeout(unloadTimer);
  unloadTimer = setTimeout(async () => {
    const p = pipe;
    pipe = null;
    (await p)?.dispose?.();
  }, IDLE_UNLOAD_MS);
  unloadTimer.unref();
  return pipe;
}

/** Any audio container ffmpeg reads -> Float32 PCM, 16 kHz mono (what Whisper expects). */
export function decodeAudio(audio: Buffer): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
    ff.stdin.on("error", () => {}); // ffmpeg may close stdin early on a bad file; the close code reports it
    ff.stdin.end(audio);
  });
}

export type Transcript = { text: string; model: string; audioSeconds: number; durationMs: number };

export async function transcribe(audio: Buffer): Promise<Transcript> {
  const started = Date.now();
  const pcm = await decodeAudio(audio);
  const asr = await model();
  const out = await asr(pcm, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) as string;
  return { text: text.trim(), model: WHISPER_MODEL, audioSeconds: Math.round((pcm.length / 16000) * 10) / 10, durationMs: Date.now() - started };
}
