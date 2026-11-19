import { callConsoleTool, CONSOLE_TOOLS } from "./console-tools";
import { callTool, TOOLS, type ToolContext } from "./tools";

const ALL_TOOLS = [...TOOLS, ...CONSOLE_TOOLS];
export type McpContext = ToolContext & { userId: string };

/**
 * A stateless MCP server over Streamable HTTP (spec 2025-06-18, older 2025-03-26 clients too): every POST carries
 * JSON-RPC, answered as one JSON body; no session, no server-to-client stream. Tools only.
 */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS =
  "Dualis Research's console, driven from Claude (nobody clicks in the console: it only shows). Design system and website words: once Thierry approves a change, publish it at once " +
  "with set_colours (a colour) or edit_files (website words, any other design token), then call change_status until it says live and give him the commit link. " +
  "Never keep a change only in the chat or in a local file: if it is not published here, it does not exist. Before drawing a chart call read_skill dualis-charts, before changing website words read_skill site-wording, and follow it (no skill upload needed). " +
  "Content, portfolio and outreach acts (draft an Idea, approve or mark a draft posted, an outreach message or status) go through their tools as soon as he says so.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

async function one(msg: Rpc, ctx: McpContext): Promise<RpcResponse | null> {
  const id = msg.id ?? null;
  if (msg.id === undefined) return null; // a notification
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dualis-research", title: "Dualis Research", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: ALL_TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      if (!ALL_TOOLS.some((t) => t.name === name)) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool ${name}` } };
      try {
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const r = TOOLS.some((t) => t.name === name) ? await callTool(name, args, ctx) : await callConsoleTool(name, args, { userId: ctx.userId });
        if (!r) throw new Error(`Unknown tool ${name}`);
        return ok({ content: [{ type: "text", text: r.text }], isError: !!r.isError });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

/** Answers one POST body (a message or a batch). Null = only notifications: HTTP 202. */
export async function handleRpc(body: unknown, ctx: McpContext): Promise<RpcResponse | RpcResponse[] | null> {
  const bad = (): RpcResponse => ({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
  const valid = (m: unknown): m is Rpc => !!m && typeof m === "object" && typeof (m as Rpc).method === "string";
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => (valid(m) ? one(m, ctx) : bad())))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  // A response from the client (to a request we never send) or a notification: nothing to answer.
  if (body && typeof body === "object" && !("method" in body)) return null;
  return valid(body) ? one(body, ctx) : bad();
}
