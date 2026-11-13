import { index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app } from "./app";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Real X accounts we post to through the X API (Kevin 2026-11-13: « commence à poster automatiquement sur notre compte
 * X connecté »). Dualis's own Developer Console (Thierry's card), one app; each account authorized it once (OAuth 2.0
 * PKCE, `tweet.write media.write offline.access`).
 * - app.x_connections: one row per connected account, its refresh token AES-GCM sealed (X_TOKEN_KEY), rotated on
 *   every use (X hands a new one each refresh and kills the old).
 * - x-publish dimension: bronze = every X API call (token refresh excluded: it carries the secret), silver
 *   x_publications = one row per Sandbox post we tried to publish, gold x_publications = what the console links to.
 */

/** One connected X account. `handle` lowercase, without @. */
export const xConnections = app.table("x_connections", {
  handle: text("handle").primaryKey(),
  /** X user id, from /2/users/me at connect time (null for a token seeded from a secret, filled on first use). */
  userId: text("user_id"),
  refreshToken: text("refresh_token").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  tokenRefreshedAt: timestamp("token_refreshed_at", { withTimezone: true }),
  /** Last refresh error (revoked app, expired token): reconnect the account. Null after a success. */
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type XConnection = typeof xConnections.$inferSelect;

/**
 * One Sandbox slot we tried to publish on X. Natural key: (account, day, slot): a review round rewrites a day under new
 * post ids, and a slot already live is never posted again. `postId` = the version actually sent.
 */
export const xPublications = silver.table(
  "x_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull(),
    accountId: text("account_id").notNull(),
    handle: text("handle").notNull(),
    day: text("day").notNull(),
    slot: integer("slot").notNull(),
    /** posted = live on X; failed = the last attempt failed (retried next tick, 3 attempts max). */
    status: text("status").$type<"posted" | "failed">().notNull(),
    tweetId: text("tweet_id"),
    mediaId: text("media_id"),
    /** The exact text sent. */
    text: text("text"),
    error: text("error"),
    attempts: integer("attempts").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("x_publications_slot_key").on(t.accountId, t.day, t.slot)],
);
export type SilverXPublication = typeof xPublications.$inferSelect;

/** What the Sandbox X pages link to. Same post id as silver. */
export const goldXPublications = gold.table(
  "x_publications",
  {
    postId: uuid("post_id").primaryKey(),
    accountId: text("account_id").notNull(),
    handle: text("handle").notNull(),
    /** A later review round writes the day again under new post ids: the page matches on (day, slot). */
    day: text("day").notNull(),
    slot: integer("slot").notNull(),
    status: text("status").$type<"posted" | "failed">().notNull(),
    tweetId: text("tweet_id"),
    url: text("url"),
    error: text("error"),
    attempts: integer("attempts").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gold_x_publications_account").on(t.accountId)],
);
export type GoldXPublication = typeof goldXPublications.$inferSelect;
