import { index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Sandbox (Kevin 2026-11-11): fake X accounts and Substack publications, one pair per posting TONE, so Thierry compares
 * tones idea by idea before we pick one for his real accounts. Nothing here is ever published anywhere.
 * - sandbox-accounts: the seed list in code (bronze = the raw definition) -> silver -> gold.
 * - sandbox-posts: each day the top Ideas written once per account in its tone (bronze = the LLM answer) -> silver -> gold.
 */

export type SandboxPlatform = "x" | "substack";
export type SandboxTone = "urgent" | "balanced" | "neutral";

/** One fake account. id = `<platform>:<handle>`. */
export const sandboxAccounts = silver.table("sandbox_accounts", {
  id: text("id").primaryKey(),
  platform: text("platform").$type<SandboxPlatform>().notNull(),
  tone: text("tone").$type<SandboxTone>().notNull(),
  /** X display name, or the Substack publication name. */
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull(),
  /** The person behind it (Substack « By ... »). */
  author: text("author").notNull(),
  bio: text("bio").notNull(),
  /** Shown only, never fetched (`<handle>.substack.com`). */
  url: text("url").notNull(),
  avatarText: text("avatar_text").notNull(),
  avatarColor: text("avatar_color").notNull(),
  bannerColor: text("banner_color").notNull(),
  pairedAccountId: text("paired_account_id").notNull(),
  followers: integer("followers").notNull(),
  following: integer("following").notNull(),
  joined: text("joined").notNull(),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SilverSandboxAccount = typeof sandboxAccounts.$inferSelect;

/** What the Sandbox pages read. Same id as silver. */
export const goldSandboxAccounts = gold.table("sandbox_accounts", {
  id: text("id").primaryKey(),
  platform: text("platform").$type<SandboxPlatform>().notNull(),
  tone: text("tone").$type<SandboxTone>().notNull(),
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull(),
  author: text("author").notNull(),
  bio: text("bio").notNull(),
  url: text("url").notNull(),
  avatarText: text("avatar_text").notNull(),
  avatarColor: text("avatar_color").notNull(),
  bannerColor: text("banner_color").notNull(),
  pairedAccountId: text("paired_account_id").notNull(),
  followers: integer("followers").notNull(),
  following: integer("following").notNull(),
  joined: text("joined").notNull(),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GoldSandboxAccount = typeof goldSandboxAccounts.$inferSelect;

/** One fake post (an X post or a Substack Note). Natural key: (account, day, slot). */
export const sandboxPosts = silver.table(
  "sandbox_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    /** UTC day the posts were written for. */
    day: text("day").notNull(),
    /** 0..4: the Idea's rank that day, and its display time. */
    slot: integer("slot").notNull(),
    ideaId: uuid("idea_id").notNull(),
    symbol: text("symbol"),
    text: text("text").notNull(),
    /** The Idea's content visual (silver/gold content_visuals id), when one exists. */
    visualId: uuid("visual_id"),
    /** Display time on the fake timeline. */
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sandbox_posts_natural_key").on(t.accountId, t.day, t.slot)],
);

/** The timeline each Sandbox page reads. Same id as silver. */
export const goldSandboxPosts = gold.table(
  "sandbox_posts",
  {
    id: uuid("id").primaryKey(),
    accountId: text("account_id").notNull(),
    day: text("day").notNull(),
    slot: integer("slot").notNull(),
    ideaId: uuid("idea_id").notNull(),
    symbol: text("symbol"),
    text: text("text").notNull(),
    visualId: uuid("visual_id"),
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_sandbox_posts_account").on(t.accountId, t.postAt)],
);
export type GoldSandboxPost = typeof goldSandboxPosts.$inferSelect;
