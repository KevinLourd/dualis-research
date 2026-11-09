import { desc, eq, inArray, isNotNull, and } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { activeAccounts, rebuildGoldAccounts } from "../content-accounts";

export const VOICES_DIMENSION = "content-voices";
export const CLAUDE_SOURCE = "claude";

/** Publications Thierry admires (docs/references.md): their FORMAT is borrowed, never their voice. */
const ADMIRED_HOSTS = ["read.aurelionresearch.com", "www.citriniresearch.com", "multibaggerideas.substack.com"];
const OWN_POSTS = 8;
const ADMIRED_POSTS = 2;

export const VOICE_SYSTEM = [
  "You write a style guide for a ghostwriter who will write posts AS one specific account of an equity research writer.",
  "Learn the voice from the account's OWN texts: tone, sentence length, how a post opens, how numbers and sources are cited, vocabulary, what it never does.",
  "From the admired publications, take only formats that fit this channel (structure, hooks, chart captions), never their voice.",
  "When the account has no texts of its own on this channel, learn from the same person's texts on another channel and say how this channel's norms change them.",
  "Write 120 to 200 words, plain text, short imperative lines. No em dash, no en dash.",
].join("\n");

type Material = { label: string; text: string };
type Prepared = { accountId: string; channel: string; name: string; owner: string; inputKey: string; basis: string; own: Material[]; admired: Material[] };
const prepared = new Map<string, Prepared>();

export function voicePrompt(p: Prepared): string {
  const block = (m: Material[]) => m.map((x) => `### ${x.label}\n${x.text}`).join("\n\n");
  return [
    `Account: ${p.name} (${p.channel}, owner: ${p.owner})`,
    "",
    "## The account's own texts",
    p.own.length ? block(p.own) : "None on this channel.",
    "",
    "## Admired publications (formats only)",
    block(p.admired),
  ].join("\n");
}

/** One stored guide per account and input set: writes only when the inputs changed. */
export const claudeVoice: Source = {
  name: CLAUDE_SOURCE,
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(subject, ctx) {
    const p = prepared.get(subject);
    if (!p) throw new Error(`no prepared inputs for ${subject}`);
    if (!ctx.complete) throw new Error("no LLM in the collector context");
    const prompt = voicePrompt(p);
    const { text, model } = await ctx.complete({ system: VOICE_SYSTEM, prompt });
    const guide = text.replace(/\s*[—–]\s*/g, ", ").trim();
    const request = { accountId: p.accountId, inputKey: p.inputKey, basis: p.basis, model, prompt };
    return { request, httpStatus: null, payloadText: guide };
  },
};

export const contentVoices: Dimension = {
  name: VOICES_DIMENSION,
  description: "The voice of each account as a style guide, learned from its own posts, pasted samples and the publications Thierry admires.",
  sources: [claudeVoice],
  subjects: pickVoiceSubjects,
  promote: promoteVoices,
};

const excerptsOf = async (db: Db, hosts: string[], limit: number): Promise<Material[]> => {
  if (hosts.length === 0) return [];
  const rows = await db
    .select({ title: content.contentPosts.title, excerpt: content.contentPosts.excerpt, host: content.contentPosts.publicationHost })
    .from(content.contentPosts)
    .where(and(inArray(content.contentPosts.publicationHost, hosts), isNotNull(content.contentPosts.excerpt)))
    .orderBy(desc(content.contentPosts.publishedAt));
  const out: Material[] = [];
  for (const host of hosts) out.push(...rows.filter((r) => r.host === host).slice(0, limit).map((r) => ({ label: r.title, text: r.excerpt! })));
  return out;
};

/** Accounts whose current inputs have no stored guide yet. */
export async function pickVoiceSubjects(db: Db): Promise<string[]> {
  prepared.clear();
  const accounts = await activeAccounts(db);
  const thierrySubstacks = accounts.filter((a) => a.channel === "substack" && a.owner === "thierry").map((a) => new URL(a.url).hostname);
  const admired = await excerptsOf(db, ADMIRED_HOSTS, ADMIRED_POSTS);
  const out: string[] = [];
  for (const a of accounts) {
    const ownHosts = a.channel === "substack" ? [new URL(a.url).hostname] : [];
    let own: Material[] = [
      ...(await excerptsOf(db, ownHosts, OWN_POSTS)),
      ...a.samples.map((s, i) => ({ label: `Pasted ${a.channel} post ${i + 1}`, text: s })),
    ];
    const basisParts: string[] = [];
    if (own.length) basisParts.push(`${own.length} of its own posts`);
    if (a.websiteText) {
      own.push({ label: `${a.name} website`, text: a.websiteText });
      basisParts.push("its website");
    }
    if (own.length === 0 && a.owner === "thierry") {
      // Same person, other channel: his Substack teaches his voice until LinkedIn / X posts are pasted.
      own = (await excerptsOf(db, thierrySubstacks, OWN_POSTS)).map((m) => ({ ...m, label: `Substack: ${m.label}` }));
      if (own.length) basisParts.push(`${own.length} of his Substack posts (paste ${a.channel} posts to sharpen it)`);
    }
    if (own.length === 0) continue; // nothing of theirs to learn from: the Channels page says so
    basisParts.push(`formats from ${admired.length} admired posts`);
    const inputKey = hashKey(JSON.stringify([VOICE_SYSTEM, own, admired.map((m) => m.label)]));
    const [stored] = await db
      .select({ id: content.contentVoices.id })
      .from(content.contentVoices)
      .where(and(eq(content.contentVoices.accountId, a.id), eq(content.contentVoices.inputKey, inputKey)));
    if (stored) continue;
    prepared.set(a.id, { accountId: a.id, channel: a.channel, name: a.name, owner: a.owner, inputKey, basis: basisParts.join(", "), own, admired });
    out.push(a.id);
  }
  return out;
}

/** Bronze guide -> silver.content_voices (one row per account x input key, stored once) -> gold accounts. */
export async function promoteVoices(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => !r.error && r.source === CLAUDE_SOURCE)) {
    const req = f.request as { accountId: string; inputKey: string; basis: string; model: string };
    const inserted = await db
      .insert(content.contentVoices)
      .values({ accountId: req.accountId, inputKey: req.inputKey, guide: f.payloadText ?? "", basis: req.basis, model: req.model, sources: [CLAUDE_SOURCE], bronzeIds: [f.id] })
      .onConflictDoNothing()
      .returning({ id: content.contentVoices.id });
    n += inserted.length;
  }
  await rebuildGoldAccounts(db);
  return { silverRowsBySource: { [CLAUDE_SOURCE]: n } };
}

/** Latest voice guide per account (writers read it). */
export async function voiceGuides(db: Db): Promise<Map<string, string>> {
  const rows = await db.select().from(content.contentVoices).orderBy(desc(content.contentVoices.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.accountId)) out.set(r.accountId, r.guide);
  return out;
}

/** Stable short key of a string (FNV-1a, 2 x 32 bit): pure JS, so the console bundle needs no node:crypto. */
export function hashKey(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
