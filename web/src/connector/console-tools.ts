import { desc, eq, sql } from "drizzle-orm";
import { PROPOSED_FORMATS, type DraftFormat } from "@/collectors/dimensions/content-drafts/format";
import { dispatchDraftWriter } from "@/content/dispatch";
import { type DraftStatus, requestDraft, setDraftStatus } from "@/content/manual";
import { getDb } from "@/db/client";
import { goldContentDrafts, goldContentIdeas } from "@/db/schema/content";
import { outreachStatusValues, type OutreachStatus } from "@/db/schema/growth";
import type { Db } from "@/db/types";
import { withWriteDb } from "@/db/write";
import { recordOutreachEdit } from "@/growth/manual";

/**
 * The console's acts, done by a Claude through the connector (Kevin 2026-11-18: « CLAUDE DESKTOP POUR LUI, ET
 * CONDUCTOR POUR MOI. ON NE VEUT PAS CLIQUER »): the console only reads. Each write is recorded exactly as the old
 * buttons recorded it (bronze source "console", the signed-in user's id), so provenance and « his word wins » hold.
 */
type Result = { text: string; isError?: boolean };
export type ConsoleToolDeps = { userId: string; read?: () => Db; write?: <T>(fn: (db: Db) => Promise<T>) => Promise<T>; dispatch?: () => Promise<boolean> };

const DRAFT_STATUSES: DraftStatus[] = ["draft", "approved", "posted", "dismissed"];
const str = { type: "string" } as const;

export const CONSOLE_TOOLS = [
  {
    name: "list_ideas",
    description: "The content Ideas of the last days (id, ticker, title, best format and score, draft requests). Read before draft_idea.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Default 20" } }, additionalProperties: false },
  },
  {
    name: "draft_idea",
    description: `Ask the writer for a draft of one Idea in one format (${PROPOSED_FORMATS.join(", ")}). The draft is written in about 3 minutes; then list_drafts shows it.`,
    inputSchema: { type: "object", properties: { idea_id: str, format: { type: "string", enum: [...PROPOSED_FORMATS] } }, required: ["idea_id", "format"], additionalProperties: false },
  },
  {
    name: "list_drafts",
    description: "The latest drafts (id, ticker, format, status, text), newest first, optionally of one status.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: DRAFT_STATUSES }, limit: { type: "number", description: "Default 10" } }, additionalProperties: false },
  },
  {
    name: "set_draft_status",
    description: "Approve, dismiss, send back to review, or mark posted a draft (with the published post's link when known).",
    inputSchema: { type: "object", properties: { draft_id: str, status: { type: "string", enum: DRAFT_STATUSES }, posted_url: str }, required: ["draft_id", "status"], additionalProperties: false },
  },
  {
    name: "update_outreach",
    description: "Change an outreach message to a Substack writer and/or its status (sent, replied, cited, declined, dropped, draft), keyed by the writer's handle.",
    inputSchema: { type: "object", properties: { handle: str, status: { type: "string", enum: [...outreachStatusValues] }, message: str }, required: ["handle"], additionalProperties: false },
  },
] as const;

export async function callConsoleTool(name: string, args: Record<string, unknown>, deps: ConsoleToolDeps): Promise<Result | null> {
  const read = deps.read ?? getDb;
  const write = deps.write ?? withWriteDb;
  const userId = deps.userId;
  switch (name) {
    case "list_ideas": {
      const limit = Math.min(Number(args.limit ?? 20) || 20, 50);
      const rows = await read().select().from(goldContentIdeas).orderBy(desc(goldContentIdeas.day), sql`${goldContentIdeas.bestScore} desc nulls last`).limit(limit);
      if (!rows.length) return { text: "No Ideas yet." };
      return {
        text: rows
          .map((i) => `${i.id} | ${i.day} | ${i.symbol ?? "-"} | ${i.title} | best ${i.bestFormat ?? "-"} ${i.bestScore ?? ""} | requests: ${i.requests.map((r) => `${r.format} ${r.status}`).join(", ") || "none"}`)
          .join("\n"),
      };
    }
    case "draft_idea": {
      const format = String(args.format) as DraftFormat;
      if (!(PROPOSED_FORMATS as readonly string[]).includes(format)) throw new Error(`format is one of ${PROPOSED_FORMATS.join(", ")}`);
      await write((db) => requestDraft(db, String(args.idea_id), format, userId));
      const started = await (deps.dispatch ?? (() => dispatchDraftWriter()))();
      return { text: started ? "Draft asked: the writer runs now, about 3 minutes. Then call list_drafts." : "Draft asked: it is written with the next morning run." };
    }
    case "list_drafts": {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 30);
      const status = args.status ? String(args.status) : null;
      const q = read().select().from(goldContentDrafts);
      const rows = await (status ? q.where(eq(goldContentDrafts.status, status)) : q).orderBy(desc(goldContentDrafts.createdAt)).limit(limit);
      if (!rows.length) return { text: "No drafts." };
      return { text: rows.map((d) => `${d.id} | ${d.symbol ?? "-"} | ${d.format} | ${d.status} | ${d.createdAt.toISOString().slice(0, 16)}\n${d.title ? `${d.title}\n` : ""}${d.body}`).join("\n\n---\n\n") };
    }
    case "set_draft_status": {
      const status = String(args.status) as DraftStatus;
      if (!DRAFT_STATUSES.includes(status)) throw new Error(`status is one of ${DRAFT_STATUSES.join(", ")}`);
      await write((db) => setDraftStatus(db, String(args.draft_id), status, { postedUrl: args.posted_url ? String(args.posted_url) : null, userId }));
      return { text: `Draft ${args.draft_id} is now ${status}.` };
    }
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

