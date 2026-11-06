import { query } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_MODEL } from "./model";

export type CompleteRequest = { system: string; prompt: string; model?: string };
export type CompleteResult = { text: string; model: string };
/** Any text completion. Tests inject a fake; production uses `completeWithSubscription`. */
export type Complete = (req: CompleteRequest) => Promise<CompleteResult>;

export { DEFAULT_MODEL };

/**
 * The ONLY way this project calls an LLM: Kevin's Claude subscription through the Claude Agent SDK, so a call
 * costs $0. Reads CLAUDE_OAUTH_TOKEN; the paid ANTHROPIC_API_KEY is never forwarded, even if set.
 * Runs in Node only (GitHub Actions collectors, scripts): the SDK spawns a process, Workers cannot.
 */
export const completeWithSubscription: Complete = async ({ system, prompt, model = DEFAULT_MODEL }) => {
  const token = process.env.CLAUDE_OAUTH_TOKEN;
  if (!token) throw new Error("CLAUDE_OAUTH_TOKEN is not set (Kevin's Claude subscription token)");

  const stream = query({
    prompt,
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
    return { text: message.result, model };
  }
  throw new Error("Claude call ended without a result");
};
