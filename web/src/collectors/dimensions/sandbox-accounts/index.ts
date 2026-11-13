import { notInArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as sandbox from "@/db/schema/sandbox";
import type { SandboxPlatform, SandboxTone } from "@/db/schema/sandbox";
import type { Db } from "@/db/types";
import { COLOR } from "@/design/tokens";
import type { Dimension, PromoteResult, Source } from "../../types";

/**
 * Sandbox accounts (Kevin 2026-11-11): 3 fake X accounts + 3 fake Substack publications, one pair per posting TONE,
 * so Thierry compares tones before we pick one for his real X and Substack. Fictional people, nothing is ever published.
 * The list lives here in code; each run lands it in bronze as is, silver keeps one row per account, gold what the pages read.
 */

export const SANDBOX_ACCOUNTS_DIMENSION = "sandbox-accounts";
export const SEED_SOURCE = "seed";
const SUBJECT = "sandbox-accounts@v1";

export type SandboxAccountSeed = {
  platform: SandboxPlatform;
  tone: SandboxTone;
  displayName: string;
  handle: string;
  author: string;
  bio: string;
  url: string;
  avatarText: string;
  avatarColor: string;
  bannerColor: string;
  followers: number;
  following: number;
  joined: string;
};

export const sandboxAccountId = (platform: SandboxPlatform, handle: string) => `${platform}:${handle.toLowerCase()}`;

type Pair = { tone: SandboxTone; name: string; handle: string; author: string; xBio: string; tagline: string; color: string; joined: string; xFollowers: number; subscribers: number };

const PAIRS: Pair[] = [
  {
    tone: "urgent",
    name: "Siren Small Caps",
    handle: "sirensmallcaps",
    author: "Max Rourke",
    xBio: "Breaking moves in small caps before the crowd sees them. Filings, numbers, no fluff.",
    tagline: "The small-cap alarms you need before the open.",
    color: COLOR["chart-series-2"].light,
    joined: "March 2025",
    xFollowers: 2_418,
    subscribers: 1_140,
  },
  {
    tone: "balanced",
    name: "Narrative Gap",
    handle: "narrativegap",
    author: "Elena Varga",
    xBio: "Long/short ideas where the price story and the numbers disagree. Small and mid caps, eight markets.",
    tagline: "When the price tells one story and the filings tell another.",
    color: COLOR.brand.light,
    joined: "January 2025",
    xFollowers: 1_876,
    subscribers: 930,
  },
  {
    tone: "neutral",
    name: "Ledger and Lens",
    handle: "ledgerlens",
    author: "Jonas Hale",
    xBio: "Independent equity research notes on under-covered small and mid caps.",
    tagline: "Research notes on companies the market covers least.",
    color: COLOR["chart-series-10"].light,
    joined: "September 2024",
    xFollowers: 1_202,
    subscribers: 712,
  },
];

/** Thierry 2026-11-12: these accounts are marketing partners of Dualis Research, never Dualis itself, so a clickbaity tone
 * never dents its authority; the bio says so. */
export const PARTNER_LINE = "Partnered with Dualis Research.";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

/** The 6 accounts: per tone one X account whose bio links to its Substack, and that Substack. */
export const SANDBOX_ACCOUNTS: SandboxAccountSeed[] = PAIRS.flatMap((p) => {
  const url = `${p.handle}.substack.com`;
  const shared = { tone: p.tone, handle: p.handle, author: p.author, avatarText: initials(p.name), avatarColor: p.color, bannerColor: COLOR.deep.light, joined: p.joined };
  return [
    { ...shared, platform: "x" as const, displayName: p.name, bio: `${p.xBio} ${PARTNER_LINE} Research: ${url}`, url, followers: p.xFollowers, following: 180 + p.xFollowers % 200 },
    { ...shared, platform: "substack" as const, displayName: p.name, bio: `${p.tagline} ${PARTNER_LINE}`, url, followers: p.subscribers, following: 0 },
  ];
});

/** The seed list itself: no external call, the definition lands in bronze like any fetch. */
export const seedSource: Source = {
  name: SEED_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject) {
    return { request: { subject }, httpStatus: null, payload: { accounts: SANDBOX_ACCOUNTS } };
  },
};

export const sandboxAccounts: Dimension = {
  name: SANDBOX_ACCOUNTS_DIMENSION,
  description: "Sandbox: 3 fake X accounts and 3 fake Substacks, one pair per posting tone (urgent, balanced, neutral). Never published.",
  sources: [seedSource],
  subjects: async () => [SUBJECT],
  promote: promoteSandboxAccounts,
};

/** Latest seed in bronze -> silver.sandbox_accounts -> gold.sandbox_accounts (an account dropped from the seed leaves both). */
export async function promoteSandboxAccounts(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const latest = fetches.filter((f) => f.source === SEED_SOURCE && !f.error).at(-1);
  if (!latest) return { silverRowsBySource: {} };
  const seeds = (latest.payload as { accounts: SandboxAccountSeed[] }).accounts;
  const ids = seeds.map((s) => sandboxAccountId(s.platform, s.handle));
  for (const s of seeds) {
    const id = sandboxAccountId(s.platform, s.handle);
    const pairedAccountId = sandboxAccountId(s.platform === "x" ? "substack" : "x", s.handle);
    const row = { id, ...s, pairedAccountId };
    const silverRow = { ...row, sources: [SEED_SOURCE], bronzeIds: [latest.id], updatedAt: new Date() };
    await db.insert(sandbox.sandboxAccounts).values(silverRow).onConflictDoUpdate({ target: sandbox.sandboxAccounts.id, set: silverRow });
    const goldRow = { ...row, rebuiltAt: new Date() };
    await db.insert(sandbox.goldSandboxAccounts).values(goldRow).onConflictDoUpdate({ target: sandbox.goldSandboxAccounts.id, set: goldRow });
  }
  await db.delete(sandbox.sandboxAccounts).where(notInArray(sandbox.sandboxAccounts.id, ids));
  await db.delete(sandbox.goldSandboxAccounts).where(notInArray(sandbox.goldSandboxAccounts.id, ids));
  return { silverRowsBySource: { [SEED_SOURCE]: seeds.length } };
}
