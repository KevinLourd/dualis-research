import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_MODEL } from "./model";

/** `images` = pictures Claude looks at before the prompt (the Sandbox reviewer reads each post's PNG). */
export type CompleteRequest = { system: string; prompt: string; model?: string; images?: { mime: string; data: Buffer }[] };
export type CompleteResult = { text: string; model: string };
/** Any text completion. Tests inject a fake; production uses `completeWithSubscription`. */
export type Complete = (req: CompleteRequest) => Promise<CompleteResult>;

export { DEFAULT_MODEL };

/**
 * The ONLY way this project calls an LLM: Kevin's Claude subscription through the Claude Agent SDK, so a call
 * costs $0. Reads CLAUDE_OAUTH_TOKEN; the paid ANTHROPIC_API_KEY is never forwarded, even if set.
 * Runs in Node only (GitHub Actions collectors, scripts): the SDK spawns a process, Workers cannot.
 */
export const completeWithSubscription: Complete = async ({ system, prompt, model = DEFAULT_MODEL, images }) => {
  const token = process.env.CLAUDE_OAUTH_TOKEN;
  if (!token) throw new Error("CLAUDE_OAUTH_TOKEN is not set (Kevin's Claude subscription token)");

  // Pictures go in as image blocks of the one user message (the SDK's streaming input), the text after them.
  async function* withImages(): AsyncGenerator<SDKUserMessage> {
    const blocks = (images ?? []).map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mime as "image/png", data: i.data.toString("base64") } }));
    yield { type: "user", message: { role: "user", content: [...blocks, { type: "text", text: prompt }] }, parent_tool_use_id: null, session_id: "" };
  }
  const stream = query({
    prompt: images?.length ? withImages() : prompt,
    options: {
      systemPrompt: system,
      model,
      maxTurns: 1,
      tools: [],
      settingSources: [],
      persistSession: false,
      // Replaces the subprocess env entirely: no ANTHROPIC_API_KEY can leak in.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CODE_OAUTH_TOKEN: token },
    },
  });
  for await (const message of stream) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") throw new Error(`Claude call failed: ${message.subtype}`);
    // A usage limit comes back as a "success" carrying the limit message: never let it pass as an answer (it would
    // land as a draft text or a callout).
    if (message.is_error) throw new Error(`Claude call failed: ${message.result.slice(0, 200)}`);
    return { text: message.result, model };
  }
  throw new Error("Claude call ended without a result");
};
