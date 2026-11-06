import { eq } from "drizzle-orm";
import { fetches } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import { runs } from "@/db/schema/ops";
import type { Db } from "@/db/types";
import { accountId, rebuildGoldAccounts } from "@/collectors/dimensions/content-accounts";

/**
 * Thierry's own acts in the console (approve a draft, mark it posted, add an account, paste voice samples) are a manual SOURCE like
 * any other: each lands in bronze first (dimension "content-actions", source "console"), then silver, then gold.
 * No transaction: the console's Neon HTTP driver has none, so every step is one idempotent statement.
 */
export const ACTIONS_DIMENSION = "content-actions";
export const CONSOLE_SOURCE = "console";

export type DraftStatus = "draft" | "approved" | "posted" | "dismissed";
export type ChannelKind = "substack" | "x" | "linkedin";
export type AccountOwner = "thierry" | "duality" | "dualis";

async function recordAct(db: Db, subject: string, payload: Record<string, unknown>, userId: string | null, source = CONSOLE_SOURCE) {
  const [run] = await db
    .insert(runs)
    .values({ dimension: ACTIONS_DIMENSION, trigger: "console", status: "succeeded", finishedAt: new Date() })
    .returning({ id: runs.id });
  const [row] = await db
    .insert(fetches)
    .values({ runId: run.id, dimension: ACTIONS_DIMENSION, source, subject, request: { userId }, httpStatus: null, payload })
    .returning({ id: fetches.id });
  return row.id;
}

export async function setDraftStatus(
  db: Db,
  draftId: string,
  status: DraftStatus,
  opts: { postedUrl?: string | null; userId: string | null; source?: string },
) {
  const [draft] = await db.select().from(content.contentDrafts).where(eq(content.contentDrafts.id, draftId));
  if (!draft) throw new Error(`draft ${draftId} not found`);
  const postedUrl = status === "posted" ? (opts.postedUrl?.trim() || null) : draft.postedUrl;
  if (postedUrl) new URL(postedUrl); // throws on a malformed link
  const source = opts.source ?? CONSOLE_SOURCE;
  const bronzeId = await recordAct(db, `draft:${draftId}`, { status, postedUrl }, opts.userId, source);
  const now = new Date();
  await db
    .update(content.contentDrafts)
    .set({
      status,
      statusAt: now,
      postedUrl,
      sources: [...draft.sources.filter((s) => s !== source), source],
      bronzeIds: [...draft.bronzeIds.filter((_, i) => draft.sources[i] !== source), bronzeId],
    })
    .where(eq(content.contentDrafts.id, draftId));
  await db.update(content.goldContentDrafts).set({ status, statusAt: now, postedUrl }).where(eq(content.goldContentDrafts.id, draftId));
}

/** Normalizes what Thierry typed into an account URL + handle: a Substack host, an X handle or URL, a LinkedIn URL. */
export function normalizeAccount(channel: ChannelKind, raw: string): { url: string; handle: string } {
  const v = raw.trim();
  if (!v) throw new Error("empty account address");
  if (channel === "x" && /^@?[A-Za-z0-9_]{1,15}$/.test(v)) {
    const handle = v.replace(/^@/, "");
    return { url: `https://x.com/${handle}`, handle };
  }
  const url = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`);
  const host = url.hostname.toLowerCase();
  if (channel === "substack") return { url: `https://${host}`, handle: host.endsWith(".substack.com") ? host.split(".")[0] : host };
  const path = url.pathname.replace(/\/+$/, "");
  const handle = path.split("/").filter(Boolean).at(-1) ?? host;
  return { url: `https://${host}${path}/`, handle };
}

/** Thierry adds an account in Content > Channels (source "console"). */
export async function addAccount(
  db: Db,
  input: { channel: ChannelKind; owner: AccountOwner; name: string; address: string },
  userId: string | null,
) {
  const { url, handle } = normalizeAccount(input.channel, input.address);
  const id = accountId(input.channel, handle);
  const name = input.name.trim() || handle;
  const bronzeId = await recordAct(db, `account:${id}`, { action: "add", channel: input.channel, owner: input.owner, name, url, handle }, userId);
  const [existing] = await db.select().from(content.contentAccounts).where(eq(content.contentAccounts.id, id));
  const bySource = new Map((existing?.sources ?? []).map((s, i) => [s, existing!.bronzeIds[i]]));
  bySource.set(CONSOLE_SOURCE, bronzeId);
  const row = {
    id,
    channel: input.channel,
    owner: input.owner,
    name,
    url,
    handle,
    samples: existing?.samples ?? [],
    websiteText: existing?.websiteText ?? null,
    active: true,
    sources: [...bySource.keys()],
    bronzeIds: [...bySource.values()],
    updatedAt: new Date(),
  };
  await db.insert(content.contentAccounts).values(row).onConflictDoUpdate({ target: content.contentAccounts.id, set: row });
  await rebuildGoldAccounts(db);
  return id;
}

/** Thierry pastes posts of an account (LinkedIn, X have no free feed): they teach the voice at the next collection. */
export async function addSamples(db: Db, id: string, text: string, userId: string | null) {
  const samples = text
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40);
  if (samples.length === 0) throw new Error("paste at least one post (40+ characters); separate posts with a line of ---");
  const [existing] = await db.select().from(content.contentAccounts).where(eq(content.contentAccounts.id, id));
  if (!existing) throw new Error(`account ${id} not found`);
  const bronzeId = await recordAct(db, `account:${id}`, { action: "samples", samples }, userId);
  const bySource = new Map(existing.sources.map((s, i) => [s, existing.bronzeIds[i]]));
  bySource.set(CONSOLE_SOURCE, bronzeId);
  await db
    .update(content.contentAccounts)
    .set({
      samples: [...new Set([...existing.samples, ...samples])],
      sources: [...bySource.keys()],
      bronzeIds: [...bySource.values()],
      updatedAt: new Date(),
    })
    .where(eq(content.contentAccounts.id, id));
  await rebuildGoldAccounts(db);
}
