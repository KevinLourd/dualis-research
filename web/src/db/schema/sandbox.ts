import { index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
/** Format of one post (skill content-matrix): X accounts write X posts + X Articles, Substacks Notes + Articles. */
export const SANDBOX_FORMATS = ["x-post", "x-article", "substack-note", "substack-article"] as const;
export type SandboxFormat = (typeof SANDBOX_FORMATS)[number];
/** Where the post's idea comes from (skills angle-*). */
export const SANDBOX_ANGLES = ["signal", "macro-24h", "trending-format", "competitor"] as const;
export type SandboxAngle = (typeof SANDBOX_ANGLES)[number];
/** What the angle read: an Idea, a headline, a trending post, a competitor post. Kept on the post so the page can say where it came from. */
export type SandboxInput = { kind: SandboxAngle; label: string; url: string | null };

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
    ideaId: uuid("idea_id"),
    symbol: text("symbol"),
    format: text("format").$type<SandboxFormat>().notNull(),
    angle: text("angle").$type<SandboxAngle>().notNull(),
    /** Articles only. */
    title: text("title"),
    subtitle: text("subtitle"),
    /** Short post text, or the Article body (markdown). */
    text: text("text").notNull(),
    input: jsonb("input").$type<SandboxInput>().notNull(),
    /** Hash of the skill files the writer read: a skill edit shows on the next day's posts. */
    skillHash: text("skill_hash").notNull(),
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
    ideaId: uuid("idea_id"),
    symbol: text("symbol"),
    format: text("format").$type<SandboxFormat>().notNull(),
    angle: text("angle").$type<SandboxAngle>().notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    text: text("text").notNull(),
    input: jsonb("input").$type<SandboxInput>().notNull(),
    visualId: uuid("visual_id"),
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_sandbox_posts_account").on(t.accountId, t.postAt)],
);
export type GoldSandboxPost = typeof goldSandboxPosts.$inferSelect;

/**
 * Macro / market headlines (dimension `macro-news`, angle macro-24h): Google News RSS searches, $0. One row per article
 * (canonical link), every search that found it in `queries`, every source tag in `sources`.
 */
export const macroNewsItems = silver.table(
  "macro_news_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    urlKey: text("url_key").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    queries: text("queries").array().notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("macro_news_items_url_key").on(t.urlKey), index("macro_news_items_published").on(t.publishedAt)],
);

/** The last 24 h of macro headlines, most searches first. Same id as silver. */
export const goldMacroNews = gold.table("macro_news", {
  id: uuid("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  publisher: text("publisher"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  queries: text("queries").array().notNull(),
  sources: text("sources").array().notNull(),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GoldMacroNews = typeof goldMacroNews.$inferSelect;

/**
 * Recent posts of finance Substacks (dimension `substack-trending`, angle trending-format): each publication's public
 * archive JSON read on its own domain. Natural key: canonical URL; engagement as last read.
 */
export const substackTrendingPosts = silver.table("substack_trending_posts", {
  url: text("url").primaryKey(),
  host: text("host").notNull(),
  publicationName: text("publication_name"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  postDate: timestamp("post_date", { withTimezone: true }).notNull(),
  audience: text("audience"),
  wordcount: integer("wordcount"),
  reactions: integer("reactions").notNull(),
  restacks: integer("restacks").notNull(),
  comments: integer("comments").notNull(),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The 30 best performing posts of the last 30 days (reactions + 2 x restacks + comments). */
export const goldSubstackTrending = gold.table("substack_trending", {
  url: text("url").primaryKey(),
  rank: integer("rank").notNull(),
  host: text("host").notNull(),
  publicationName: text("publication_name"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  postDate: timestamp("post_date", { withTimezone: true }).notNull(),
  audience: text("audience"),
  wordcount: integer("wordcount"),
  score: integer("score").notNull(),
  reactions: integer("reactions").notNull(),
  restacks: integer("restacks").notNull(),
  comments: integer("comments").notNull(),
  rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GoldSubstackTrending = typeof goldSubstackTrending.$inferSelect;
