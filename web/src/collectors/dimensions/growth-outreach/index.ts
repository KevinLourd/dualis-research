import { and, eq } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as growth from "@/db/schema/growth";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { promoteFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import { rebuildGoldAudience } from "@/growth/audience";
import { listPrivateFiles, readPrivateFile } from "@/private/files";
import { OWN } from "../substack-network/seeds";
import { parseOutreachMarkdown, parseReadings, parseTargetContacts } from "./parse";

export const OUTREACH_DIMENSION = "growth-outreach";
/** Claude's drafts in data/outreach/*.md. */
export const DRAFT_SOURCE = "claude-draft";
/** Thierry's edits and status changes in the console (written by the app, never collected). */
export const CONSOLE_SOURCE = "console";
export const OUTREACH_DIR = "data/outreach";
/** The Contact column of the targets doc. */
export const TARGETS_SOURCE = "targets-doc";
export const TARGETS_DOC = "docs/acquisition-targets.md";
/** Kevin's readings of Thierry's count on the Substack dashboard (the public profile lags it). */
export const READINGS_SOURCE = "dashboard-reading";
export const READINGS_FILE = "data/growth/audience-readings.json";

/** One bronze row per private file a source reads, raw text kept (JSON parsed). */
function repoFile(name: string, covers: (file: string) => boolean): Source {
  return {
    name,
    requiredEnv: [],
    covers,
    async fetch(file, ctx) {
      const text = await readPrivateFile(ctx.db, file);
      return file.endsWith(".json") ? { request: { file }, httpStatus: null, payload: JSON.parse(text) } : { request: { file }, httpStatus: null, payloadText: text };
    },
  };
}

export const claudeDrafts = repoFile(DRAFT_SOURCE, (f) => f.startsWith(`${OUTREACH_DIR}/`));
export const targetsDoc = repoFile(TARGETS_SOURCE, (f) => f === TARGETS_DOC);
export const dashboardReadings = repoFile(READINGS_SOURCE, (f) => f === READINGS_FILE);

export const growthOutreach: Dimension = {
  name: OUTREACH_DIMENSION,
  description: "Messages to the Substack authors we target (Claude's drafts, contacts, Thierry's edits and statuses) and Kevin's dashboard readings of Thierry's count.",
  sources: [claudeDrafts, targetsDoc, dashboardReadings],
  async subjects(db) {
    const files = await listPrivateFiles(db, OUTREACH_DIR);
    return [...files.filter((f) => f.endsWith(".md")), TARGETS_DOC, READINGS_FILE];
  },
  promote: promoteOutreach,
};

export type ConsoleOutreachEdit = { body?: string; status?: growth.OutreachStatus; userId: string | null };

/** bronze -> silver (one row per author x source) -> gold (Thierry's word wins). */
export async function promoteOutreach(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let drafts = 0;
  let edits = 0;
  let contactRows = 0;
  const readings: Assertion[] = [];
  for (const f of [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) {
    if (f.error) continue;
    if (f.source === DRAFT_SOURCE) {
      for (const d of parseOutreachMarkdown(f.payloadText ?? "")) {
        const row = { handle: d.handle, source: DRAFT_SOURCE, publicationName: d.publicationName, hook: d.hook, ask: d.ask, body: d.body, status: "draft" as const, rank: d.rank, bronzeIds: [f.id], updatedAt: f.fetchedAt };
        await db.insert(growth.outreachMessages).values(row).onConflictDoUpdate({ target: [growth.outreachMessages.handle, growth.outreachMessages.source], set: row });
        drafts += 1;
      }
    } else if (f.source === TARGETS_SOURCE) {
      for (const [handle, contacts] of parseTargetContacts(f.payloadText ?? "")) {
        const row = { handle, source: TARGETS_SOURCE, contacts, bronzeIds: [f.id], updatedAt: f.fetchedAt };
        await db.insert(growth.outreachMessages).values(row).onConflictDoUpdate({ target: [growth.outreachMessages.handle, growth.outreachMessages.source], set: row });
        contactRows += 1;
      }
    } else if (f.source === READINGS_SOURCE) {
      for (const r of parseReadings(f.payload)) readings.push({ source: READINGS_SOURCE, field: `subscribers@${r.date}`, value: r.subscribers, bronzeId: f.id });
    } else if (f.source === CONSOLE_SOURCE) {
      const handle = f.subject.replace(/^outreach:/, "");
      const edit = f.payload as ConsoleOutreachEdit;
      const [prev] = await db
        .select()
        .from(growth.outreachMessages)
        .where(and(eq(growth.outreachMessages.handle, handle), eq(growth.outreachMessages.source, CONSOLE_SOURCE)));
      const row = {
        handle,
        source: CONSOLE_SOURCE,
        body: edit.body ?? prev?.body ?? null,
        status: edit.status ?? prev?.status ?? null,
        statusAt: edit.status ? f.fetchedAt : (prev?.statusAt ?? null),
        bronzeIds: [...(prev?.bronzeIds ?? []), f.id],
        updatedAt: f.fetchedAt,
      };
      await db.insert(growth.outreachMessages).values(row).onConflictDoUpdate({ target: [growth.outreachMessages.handle, growth.outreachMessages.source], set: row });
      edits += 1;
    }
  }
  const readingRows = readings.length ? await promoteFacts(db, OUTREACH_DIMENSION, new Map([[`pub:${OWN.publicationId}`, readings]])) : 0;
  await rebuildGoldOutreach(db);
  if (readings.length) await rebuildGoldAudience(db);
  return { silverRowsBySource: { [DRAFT_SOURCE]: drafts, [TARGETS_SOURCE]: contactRows, [READINGS_SOURCE]: readingRows, [CONSOLE_SOURCE]: edits } };
}

export async function rebuildGoldOutreach(db: Db): Promise<void> {
  const rows = await db.select().from(growth.outreachMessages);
  const byHandle = new Map<string, growth.SilverOutreachMessage[]>();
  for (const r of rows) byHandle.set(r.handle, [...(byHandle.get(r.handle) ?? []), r]);
  const gold = [...byHandle].flatMap(([handle, list]) => {
    const claude = list.find((r) => r.source === DRAFT_SOURCE);
    const mine = list.find((r) => r.source === CONSOLE_SOURCE);
    const doc = list.find((r) => r.source === TARGETS_SOURCE);
    const dm = { label: "Substack DM", href: `https://substack.com/@${handle}` };
    const body = mine?.body ?? claude?.body;
    if (!body) return [];
    return [
      {
        handle,
        publicationName: claude?.publicationName ?? null,
        hook: claude?.hook ?? null,
        ask: claude?.ask ?? null,
        body,
        bodySource: mine?.body ? CONSOLE_SOURCE : DRAFT_SOURCE,
        claudeBody: claude?.body ?? null,
        status: mine?.status ?? claude?.status ?? "draft",
        statusAt: mine?.status ? mine.statusAt : null,
        contacts: [dm, ...(doc?.contacts ?? []).filter((c) => c.href !== dm.href)],
        rank: claude?.rank ?? null,
        sources: list.filter((r) => r.source !== TARGETS_SOURCE || r.contacts?.length).map((r) => r.source).sort(),
      },
    ];
  });
  await db.delete(growth.goldGrowthOutreach);
  if (gold.length) await db.insert(growth.goldGrowthOutreach).values(gold);
}
