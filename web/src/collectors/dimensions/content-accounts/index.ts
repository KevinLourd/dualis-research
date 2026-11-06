import { eq, notInArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import { readPrivateFile } from "@/private/files";
import { getText } from "../../http";
import type { Dimension, PromoteResult, Source } from "../../types";
import { stripHtml } from "../content-posts/parse";

export const ACCOUNTS_DIMENSION = "content-accounts";
export const REPO_SOURCE = "repo";
export const WEBSITE_SOURCE = "website";
const FILE = "data/content-accounts.json";

export type AccountChannel = "substack" | "x" | "linkedin";
export type AccountOwner = "thierry" | "duality" | "dualis";
export type AccountRow = { channel: AccountChannel; owner: AccountOwner; name: string; url: string; handle: string; website?: string; samples?: string[] };

const CHANNELS: AccountChannel[] = ["substack", "x", "linkedin"];
const OWNERS: AccountOwner[] = ["thierry", "duality", "dualis"];

export const accountId = (channel: string, handle: string) => `${channel}:${handle.toLowerCase().replace(/^@/, "")}`;

/** Validates the accounts file; throws with the line at fault. */
export function parseAccounts(payload: unknown): AccountRow[] {
  const list = (payload as { accounts?: unknown })?.accounts;
  if (!Array.isArray(list)) throw new Error(`${FILE}: "accounts" must be a list`);
  return list.map((a: AccountRow, i) => {
    if (!CHANNELS.includes(a.channel)) throw new Error(`${FILE} #${i}: channel "${a.channel}" is not one of ${CHANNELS.join(", ")}`);
    if (!OWNERS.includes(a.owner)) throw new Error(`${FILE} #${i}: owner "${a.owner}" is not one of ${OWNERS.join(", ")}`);
    if (!a.name || !a.handle || !/^https?:\/\//.test(a.url ?? "")) throw new Error(`${FILE} #${i}: name, handle and an http(s) url are required`);
    return { ...a, samples: a.samples ?? [] };
  });
}

/** The accounts file (app.private_files) (the console adds accounts and samples as source `console`). */
export const accountsFile: Source = {
  name: REPO_SOURCE,
  requiredEnv: [],
  covers: (subject) => subject === FILE,
  async fetch(subject, ctx) {
    const text = await readPrivateFile(ctx.db, subject);
    return { request: { file: subject }, httpStatus: null, payload: JSON.parse(text) };
  },
};

/** An account owner's website (the fund's): its text teaches the voice when the channel has no free feed. */
export const websiteSource: Source = {
  name: WEBSITE_SOURCE,
  requiredEnv: [],
  covers: (subject) => /^https?:\/\//.test(subject),
  fetch: (url, ctx) => getText(ctx, url, { url }, { headers: { "user-agent": "DualisResearch/1.0" } }),
};

async function readAccountsFile(db: Db): Promise<AccountRow[]> {
  return parseAccounts(JSON.parse(await readPrivateFile(db, FILE)));
}

export const contentAccounts: Dimension = {
  name: ACCOUNTS_DIMENSION,
  description: "Accounts we write for per channel (Thierry, his fund Duality, Dualis) and what we learn their voice from.",
  sources: [accountsFile, websiteSource],
  subjects: async (db) => [FILE, ...new Set((await readAccountsFile(db)).flatMap((a) => (a.website ? [a.website] : [])))],
  promote: promoteAccounts,
};

/** Plain text of a web page, scripts and styles removed, capped (what the voice guide reads). */
export function pageText(html: string, max = 4000): string {
  return stripHtml(html).slice(0, max);
}

/**
 * Latest file -> silver.content_accounts. A file account keeps the samples Thierry pasted in the console (both
 * sources tagged); an account the file drops is deactivated unless the console added it.
 */
export async function promoteAccounts(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const latest = fetches.filter((f) => f.source === REPO_SOURCE && !f.error).sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
  if (!latest) return { silverRowsBySource: {} };
  const rows = parseAccounts(latest.payload);
  const ids: string[] = [];
  for (const a of rows) {
    const id = accountId(a.channel, a.handle);
    ids.push(id);
    const [existing] = await db.select().from(content.contentAccounts).where(eq(content.contentAccounts.id, id));
    // sources[i] was read from bronzeIds[i]; this file's answer replaces the repo's previous one.
    const bySource = new Map((existing?.sources ?? []).map((s, i) => [s, existing!.bronzeIds[i]]));
    bySource.set(REPO_SOURCE, latest.id);
    const site = a.website ? fetches.filter((f) => f.source === WEBSITE_SOURCE && f.subject === a.website && !f.error).at(-1) : undefined;
    if (site) bySource.set(WEBSITE_SOURCE, site.id);
    const consoleSamples = existing?.sources.includes("console") ? existing.samples.filter((s) => !(a.samples ?? []).includes(s)) : [];
    const values = {
      id,
      channel: a.channel,
      owner: a.owner,
      name: a.name,
      url: a.url,
      handle: a.handle,
      samples: [...(a.samples ?? []), ...consoleSamples],
      websiteText: site ? pageText(site.payloadText ?? "") : (existing?.websiteText ?? null),
      active: true,
      sources: [...bySource.keys()],
      bronzeIds: [...bySource.values()],
      updatedAt: new Date(),
    };
    await db.insert(content.contentAccounts).values(values).onConflictDoUpdate({ target: content.contentAccounts.id, set: values });
  }
  const dropped = await db.select().from(content.contentAccounts).where(notInArray(content.contentAccounts.id, ids.length ? ids : [""]));
  for (const d of dropped.filter((d) => !d.sources.includes("console"))) {
    await db.update(content.contentAccounts).set({ active: false, updatedAt: new Date() }).where(eq(content.contentAccounts.id, d.id));
  }
  await rebuildGoldAccounts(db);
  return { silverRowsBySource: { [REPO_SOURCE]: rows.length, [WEBSITE_SOURCE]: rows.filter((a) => a.website).length } };
}

/** gold.content_accounts = active accounts + their latest voice guide. Idempotent row writes (no transaction: the console calls it too). */
export async function rebuildGoldAccounts(db: Db) {
  const accounts = await db.select().from(content.contentAccounts);
  const voices = await db.select().from(content.contentVoices);
  for (const a of accounts) {
    if (!a.active) {
      await db.delete(content.goldContentAccounts).where(eq(content.goldContentAccounts.id, a.id));
      continue;
    }
    const v = voices.filter((x) => x.accountId === a.id).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    const row = {
      id: a.id,
      channel: a.channel,
      owner: a.owner,
      name: a.name,
      url: a.url,
      handle: a.handle,
      samples: a.samples.length,
      voiceGuide: v?.guide ?? null,
      voiceBasis: v?.basis ?? null,
      voiceAt: v?.createdAt ?? null,
      sources: a.sources,
      rebuiltAt: new Date(),
    };
    await db.insert(content.goldContentAccounts).values(row).onConflictDoUpdate({ target: content.goldContentAccounts.id, set: row });
  }
  await rebuildGoldChannels(db, accounts);
}

/** gold.content_channels: per channel, the account the public site links to (Dualis first, then Thierry, then the fund). */
async function rebuildGoldChannels(db: Db, accounts: content.SilverContentAccount[]) {
  const rank = { dualis: 0, thierry: 1, duality: 2 } as const;
  for (const channel of CHANNELS) {
    const best = accounts.filter((a) => a.active && a.channel === channel).sort((a, b) => rank[a.owner] - rank[b.owner])[0];
    if (!best) {
      await db.delete(content.goldContentChannels).where(eq(content.goldContentChannels.kind, channel));
      continue;
    }
    const row = { kind: channel, url: best.url, updatedAt: best.updatedAt, rebuiltAt: new Date() };
    await db.insert(content.goldContentChannels).values(row).onConflictDoUpdate({ target: content.goldContentChannels.kind, set: row });
  }
}

/** Active accounts of a channel, for the writers. */
export async function activeAccounts(db: Db, channel?: AccountChannel) {
  const all = await db.select().from(content.contentAccounts).where(eq(content.contentAccounts.active, true));
  return channel ? all.filter((a) => a.channel === channel) : all;
}

/** Lower-case host of a URL (used to match an account to its publication). */
export function normalizeHost(url: string): string {
  return new URL(url).hostname.toLowerCase();
}
