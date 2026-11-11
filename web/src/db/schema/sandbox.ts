import { boolean, customType, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
/**
 * The picture of one post, written by the post's own writer in the same call as its text (Kevin 2026-11-11: each tone's
 * skill decides its images too, and the image must say the post's conclusion). `chart` = `price` or an Exhibit id of the
 * Idea; `point` = the value the arrow hits (`latest` = the last one); `style` = `breaking` (news card + price card) or
 * `pro` (chart, arrow and note only). Every word on the image is here; the code draws, it never writes.
 */
export type SandboxImage = {
  chart: string;
  point: string;
  style: "breaking" | "pro";
  title: string;
  chartLabel: string;
  note: string;
  priceSays: string;
  newsLine: string | null;
  news: { index: number; domain: string } | null;
};
/** One post's reading by the reviewer (skill content-review): each check passes or fails with its why. */
export type SandboxPostReview = { post: number; imageAlone: boolean; aligned: boolean; clear: boolean; why: string };
/** One edit of a writing skill the reviewer asked for: `old` must appear once in that skill's file. */
export type SandboxSkillEdit = { skill: string; old: string; new: string; why: string; applied: boolean; reason: string | null };

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
    /** 1 = the day's first writing; each failed review (skill content-review) writes the day again as the next round. */
    round: integer("round").notNull().default(1),
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
    /** The picture the writer specified (null on posts written before 2026-11-11). */
    image: jsonb("image").$type<SandboxImage>(),
    /** The post's own picture (silver sandbox_visuals id), once drawn. */
    visualId: uuid("visual_id"),
    /** Display time on the fake timeline. */
    postAt: timestamp("post_at", { withTimezone: true }).notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sandbox_posts_round_key").on(t.accountId, t.day, t.slot, t.round)],
);

/**
 * One review of an account's day (skill content-review): the reviewer reads the round's posts with their pictures,
 * says per post whether the picture stands alone, matches the text's conclusion and reads at once, and edits the
 * writing skills when one fails. Natural key: (account, day, round). Append-only.
 */
export const sandboxReviews = silver.table(
  "sandbox_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    day: text("day").notNull(),
    round: integer("round").notNull(),
    pass: boolean("pass").notNull(),
    posts: jsonb("posts").$type<SandboxPostReview[]>().notNull(),
    edits: jsonb("edits").$type<SandboxSkillEdit[]>().notNull(),
    /** Hash of the review skill + the writing skills it read. */
    skillHash: text("skill_hash").notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sandbox_reviews_key").on(t.accountId, t.day, t.round)],
);
export type SilverSandboxReview = typeof sandboxReviews.$inferSelect;

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

/** bytea: Neon over HTTP hands back `\\x<hex>`, node-postgres / PGlite a byte array; both read as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  fromDriver: (v) => (typeof v === "string" ? Buffer.from(v.startsWith("\\x") ? v.slice(2) : v, "hex") : Buffer.from(v)),
});

/**
 * Each Sandbox post's own picture (dimension `sandbox-visuals`, Kevin 2026-11-11): drawn from the image its writer
 * specified (`SandboxImage`), an X Article's at X's 5:2 cover ratio (`x-cover`). Natural key: `key` = `post:<post id>`
 * (older rows: `price:...`, `cover:...`).
 * `/api/visuals/<id>` streams the file.
 */
export const sandboxVisuals = silver.table("sandbox_visuals", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  kind: text("kind").$type<"chart" | "x-chart" | "x-cover">().notNull(),
  symbol: text("symbol"),
  status: text("status").$type<"ok" | "failed">().notNull(),
  error: text("error"),
  mime: text("mime"),
  width: integer("width"),
  height: integer("height"),
  file: bytea("file"),
  sizeBytes: integer("size_bytes"),
  caption: text("caption"),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
