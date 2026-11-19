import { desc, eq, sql } from "drizzle-orm";
import { type PositionEdit, recordPositionEdit } from "@/collectors/dimensions/portfolio";
import { recordConsoleEdit } from "@/collectors/dimensions/thesis/console";
import { PROPOSED_FORMATS, type DraftFormat } from "@/collectors/dimensions/content-drafts/format";
import { portfolioView } from "@/console/portfolio-queries";
import { dispatchDraftWriter } from "@/content/dispatch";
import { type DraftStatus, requestDraft, setDraftStatus } from "@/content/manual";
import { getDb } from "@/db/client";
import { goldContentDrafts, goldContentIdeas } from "@/db/schema/content";
import { outreachStatusValues, type OutreachStatus } from "@/db/schema/growth";
import { theses } from "@/db/schema/thesis";
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
    name: "list_positions",
    description: "Thierry's portfolio positions as the console shows them (direction, entry date and price, weight, status, current price).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "edit_position",
    description: "Record Thierry's own facts on one portfolio position. Give only the fields he stated; his word wins over what a post said.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: str,
        direction: { type: "string", enum: ["long", "short"] },
        entry_date: { type: "string", description: "YYYY-MM-DD" },
        entry_price: { type: "number" },
        weight_percent: { type: "number", description: "Percent of the portfolio, 0-100" },
        status: { type: "string", enum: ["open", "closed"] },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "set_fair_value",
    description: "Record Thierry's own fair value per share for a ticker (his number wins over Claude's), with how he got it.",
    inputSchema: { type: "object", properties: { symbol: str, value: { type: "number" }, basis: { type: "string", description: "e.g. 10x EV/EBITDA on 2027 EBITDA" } }, required: ["symbol", "value"], additionalProperties: false },
  },
  {
    name: "update_outreach",
    description: "Change an outreach message to a Substack writer and/or its status (sent, replied, cited, declined, dropped, draft), keyed by the writer's handle.",
    inputSchema: { type: "object", properties: { handle: str, status: { type: "string", enum: [...outreachStatusValues] }, message: str }, required: ["handle"], additionalProperties: false },
  },
] as const;

const clean = (s: string) => s.replace(/\s*[—–]\s*/g, ", ").trim();

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
    case "list_positions": {
      const { positions } = await portfolioView();
      return {
        text: positions
          .map((p) => `${p.symbol} ${p.name ?? ""} | ${p.direction ?? "?"} | entry ${p.entryDate ?? "?"} @ ${p.entryPrice ?? "?"} | weight ${p.weight !== null ? `${(p.weight * 100).toFixed(1)}%` : "?"} | ${p.status ?? "?"} | now ${p.close ?? "?"} ${p.currency ?? ""}`)
          .join("\n"),
      };
    }
    case "edit_position": {
      const symbol = String(args.symbol ?? "").trim();
      if (!symbol) throw new Error("symbol is required");
      const edits = positionEdits(args);
      if (!edits.length) throw new Error("Give at least one field to change");
      await write(async (db) => {
        for (const e of edits) await recordPositionEdit(db, symbol, { ...e, userId });
      });
      return { text: `${symbol}: ${edits.map((e) => `${e.field} = ${e.field === "weight" ? `${(Number(e.value) * 100).toFixed(1)}%` : e.value}`).join(", ")}. The Portfolio page shows it now.` };
    }
    case "set_fair_value": {
      const symbol = String(args.symbol ?? "").trim();
      const value = args.value;
      if (typeof value !== "number" || !(value > 0)) throw new Error("value must be a positive number");
      const [thesis] = await read().select({ currency: theses.currency }).from(theses).where(eq(theses.symbol, symbol));
      if (!thesis) throw new Error(`No thesis for ${symbol}: is it an analysed ticker?`);
      const basis = args.basis ? clean(String(args.basis)) : null;
      await write((db) => recordConsoleEdit(db, symbol, { field: "fairValue", value: { value, currency: thesis.currency, basis }, action: "edit", userId }));
      return { text: `${symbol}: Thierry's fair value ${value} ${thesis.currency ?? ""} saved; the next analysis run reads it.` };
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

/** The same checks the old Portfolio form made. */
export function positionEdits(args: Record<string, unknown>): Omit<PositionEdit, "userId">[] {
  const edits: Omit<PositionEdit, "userId">[] = [];
  if (args.direction !== undefined) {
    if (args.direction !== "long" && args.direction !== "short") throw new Error("direction is long or short");
    edits.push({ field: "direction", value: args.direction });
  }
  if (args.entry_date !== undefined) {
    if (typeof args.entry_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.entry_date)) throw new Error("entry_date is YYYY-MM-DD");
    edits.push({ field: "entryDate", value: args.entry_date });
  }
  if (args.entry_price !== undefined) {
    if (typeof args.entry_price !== "number" || !(args.entry_price > 0)) throw new Error("entry_price must be a positive number");
    edits.push({ field: "entryPrice", value: args.entry_price });
  }
  if (args.weight_percent !== undefined) {
    const w = args.weight_percent;
    if (typeof w !== "number" || !(w > 0) || w > 100) throw new Error("weight_percent is a percent of the portfolio, above 0 and 100 at most");
    edits.push({ field: "weight", value: w / 100 });
  }
  if (args.status !== undefined) {
    if (args.status !== "open" && args.status !== "closed") throw new Error("status is open or closed");
    edits.push({ field: "status", value: args.status });
  }
  return edits;
}
