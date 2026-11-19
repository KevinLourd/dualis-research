import { outreachStatusValues, type OutreachStatus } from "@/db/schema/growth";
import type { Db } from "@/db/types";
import { withWriteDb } from "@/db/write";
import { recordOutreachEdit } from "@/growth/manual";

/**
 * The console's acts a Claude does through the connector (Kevin 2026-11-18: « ON NE VEUT PAS CLIQUER »), recorded
 * exactly as the old buttons were (bronze source "console", the signed-in user's id). Drafts are not here (Kevin
 * 2026-11-19): the 2 daily posts reach Thierry on WhatsApp, where « go » counts a post as published.
 */
type Result = { text: string; isError?: boolean };
export type ConsoleToolDeps = { userId: string; write?: <T>(fn: (db: Db) => Promise<T>) => Promise<T> };

const str = { type: "string" } as const;

export const CONSOLE_TOOLS = [
  {
    name: "update_outreach",
    description: "Change an outreach message to a Substack writer and/or its status (sent, replied, cited, declined, dropped, draft), keyed by the writer's handle.",
    inputSchema: { type: "object", properties: { handle: str, status: { type: "string", enum: [...outreachStatusValues] }, message: str }, required: ["handle"], additionalProperties: false },
  },
] as const;

export async function callConsoleTool(name: string, args: Record<string, unknown>, deps: ConsoleToolDeps): Promise<Result | null> {
  const write = deps.write ?? withWriteDb;
  const userId = deps.userId;
  switch (name) {
    case "update_outreach": {
      const handle = String(args.handle ?? "").replace(/^@/, "").trim();
      if (!handle) throw new Error("handle is required");
      const status = args.status ? (String(args.status) as OutreachStatus) : undefined;
      const body = args.message !== undefined ? String(args.message) : undefined;
      if (!status && body === undefined) throw new Error("Give a status and/or a message");
      await write((db) => recordOutreachEdit(db, handle, { ...(status ? { status } : {}), ...(body !== undefined ? { body } : {}), userId }));
      return { text: `@${handle}: ${[status && `status ${status}`, body !== undefined && "message saved"].filter(Boolean).join(", ")}.` };
    }
  }
  return null;
}

