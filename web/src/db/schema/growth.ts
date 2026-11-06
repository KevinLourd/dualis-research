import { boolean, date, doublePrecision, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Growth dimensions (November goal: +1K Substack subscribers through borrowed audiences, skill `audience`).
 * - substack-network: Substack's public recommendation graph crawled 2 hops from our seeds. Bronze = every answer
 *   (archive, recommendations, public profile); silver = publications, authors, recommendation edges, and the dated
 *   subscriber counts / last post dates in silver.facts; gold = the ranked targets + Thierry's own subscriber series.
 * - growth-outreach: the messages to the targets' authors. Claude's drafts (data/outreach/*.md, source
 *   "claude-draft"), their contacts (docs/acquisition-targets.md, source "targets-doc"), Thierry's edits and status
 *   changes (source "console"); gold = Thierry's word wins. Also Kevin's dashboard readings of Thierry's count
 *   (data/growth/audience-readings.json, source "dashboard-reading"), which win over the lagging public count.
 */

/** One Substack publication. Natural key: Substack publication id. */
export const substackPublications = silver.table(
  "substack_publications",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Custom domain, else <subdomain>.substack.com. */
    host: text("host").notNull(),
    heroText: text("hero_text"),
    authorHandle: text("author_handle"),
    authorName: text("author_name"),
    paymentsState: text("payments_state"),
    /** Seed hosts whose crawl reached it (a seed reaches itself): a publication found from two seeds carries both. */
    reachedFrom: text("reached_from").array().notNull(),
    /** Substack answers that described it: "substack-recommendations" (as a recommended publication), "substack-archive" (its own posts). */
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("substack_publications_author").on(t.authorHandle)],
);
export type SilverSubstackPublication = typeof substackPublications.$inferSelect;

/** "from recommends to". Natural key: (from, to). A recommendation gone from `from`'s latest list is deleted (bronze keeps it). */
export const substackRecommendations = silver.table(
  "substack_recommendations",
  {
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] }), index("substack_recommendations_to").on(t.toId)],
);

export const outreachStatusValues = ["draft", "sent", "replied", "cited", "declined", "dropped"] as const;
export type OutreachStatus = (typeof outreachStatusValues)[number];
/** A way to reach an author: Substack DM, email (mailto:), X... */
export type OutreachContact = { label: string; href: string };

/** One author's message as ONE source last said it. Natural key: (handle, source). Gold picks Thierry's over Claude's. */
export const outreachMessages = silver.table(
  "outreach_messages",
  {
    handle: text("handle").notNull(),
    source: text("source").notNull(),
    publicationName: text("publication_name"),
    hook: text("hook"),
    ask: text("ask"),
    body: text("body"),
    status: text("status").$type<OutreachStatus>(),
    statusAt: timestamp("status_at", { withTimezone: true }),
    /** How to reach the author (source "targets-doc": the Contact column of docs/acquisition-targets.md). */
    contacts: jsonb("contacts").$type<OutreachContact[]>(),
    /** Order in Claude's file. */
    rank: integer("rank"),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.handle, t.source] })],
);
export type SilverOutreachMessage = typeof outreachMessages.$inferSelect;

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Ranked targets: only what the ranking needs (candidates of our niche + every drafted author), not the whole graph.
 * `inbound` = publications of the crawled cluster that recommend it. `inactive` = no post for 60 days.
 */
export const goldGrowthTargets = gold.table(
  "growth_targets",
  {
    publicationId: text("publication_id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    heroText: text("hero_text"),
    authorHandle: text("author_handle"),
    authorName: text("author_name"),
    subscribers: integer("subscribers"),
    subscribersAt: date("subscribers_at"),
    inbound: integer("inbound").notNull(),
    lastPostAt: timestamp("last_post_at", { withTimezone: true }),
    inactive: boolean("inactive").notNull(),
    /** Stored judgment: does its reader match ours? yes / partly / no; null until judged. */
    fit: text("fit"),
    fitProbability: doublePrecision("fit_probability"),
    fitSentence: text("fit_sentence"),
    /** Why it is not an active target (stopped, paused), from docs/acquisition-targets.md. */
    excludedReason: text("excluded_reason"),
    score: doublePrecision("score").notNull(),
    rank: integer("rank").notNull(),
    recentPosts: jsonb("recent_posts").$type<{ title: string; date: string; audience: string | null; url: string | null }[]>().notNull(),
    sources: text("sources").array().notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_growth_targets_author").on(t.authorHandle)],
);
export type GoldGrowthTarget = typeof goldGrowthTargets.$inferSelect;

/** Thierry's own Substack subscriber count, one row per day (latest reading of the day). */
export const goldGrowthAudience = gold.table("growth_audience", {
  date: date("date").primaryKey(),
  subscribers: integer("subscribers").notNull(),
  sources: text("sources").array().notNull(),
  rebuiltAt,
});

/** One message per author, as the Growth page shows it: Thierry's word wins over Claude's draft. */
export const goldGrowthOutreach = gold.table("growth_outreach", {
  handle: text("handle").primaryKey(),
  publicationName: text("publication_name"),
  hook: text("hook"),
  ask: text("ask"),
  body: text("body").notNull(),
  /** Who wrote the body shown: "console" (Thierry) or "claude-draft". */
  bodySource: text("body_source").notNull(),
  /** Claude's draft, kept beside Thierry's edit. */
  claudeBody: text("claude_body"),
  status: text("status").$type<OutreachStatus>().notNull(),
  statusAt: timestamp("status_at", { withTimezone: true }),
  /** Substack DM first (always, from the handle), then what the targets doc lists. */
  contacts: jsonb("contacts").$type<OutreachContact[]>().notNull(),
  rank: integer("rank"),
  /** First crawl that saw the author's publication recommend Analysis Paralysis (substack-network); null = not (yet). */
  recommendsUsSince: timestamp("recommends_us_since", { withTimezone: true }),
  sources: text("sources").array().notNull(),
  rebuiltAt,
});
export type GoldGrowthOutreach = typeof goldGrowthOutreach.$inferSelect;
