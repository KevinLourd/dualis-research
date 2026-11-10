import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gold } from "./gold";
import { silver } from "./silver";

/**
 * Content dimensions.
 * - content-posts: every post of the research publications Thierry follows (and his own), read from their public
 *   Substack feeds. Bronze = raw feed answers; silver = one row per post, deduplicated across sources (RSS + archive
 *   JSON), every source tag kept; gold = the Library the console reads.
 * - content-drafts: ready drafts per channel built from a news worth it + the ticker's thesis. Bronze = every LLM
 *   generation; silver = one row per (generation, format) with its inputs; gold = the drafts queue.
 * - content-channels: Thierry's own channel URLs, typed in the console (manual source "console").
 */

/** Where a post or draft lives. X and LinkedIn posts of others have no free API: never collected. */
export const contentFormatEnum = silver.enum("content_format", ["substack-article", "substack-note", "x-post", "linkedin-post"]);
export const draftStatusEnum = silver.enum("draft_status", ["draft", "approved", "posted", "dismissed"]);
export const channelKindEnum = silver.enum("channel_kind", ["substack", "x", "linkedin"]);

/** One publication or account we read. Natural key: host (e.g. "www.citriniresearch.com"). */
export const contentPublications = silver.table("content_publications", {
  host: text("host").primaryKey(),
  name: text("name").notNull(),
  /** "reference" = a publication Thierry follows; "own" = his. */
  kind: text("kind").$type<"reference" | "own">().notNull(),
  author: text("author"),
  description: text("description"),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One post. Natural key: canonical URL. `sources[i]` was last read from `bronzeIds[i]`. */
export const contentPosts = silver.table(
  "content_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    urlKey: text("url_key").notNull(),
    url: text("url").notNull(),
    publicationHost: text("publication_host")
      .notNull()
      .references(() => contentPublications.host, { onDelete: "cascade" }),
    format: contentFormatEnum("format").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** "everyone" | "only_paid" | "founding" when a source says; null when unknown. */
    audience: text("audience"),
    wordCount: integer("word_count"),
    imageUrl: text("image_url"),
    /** First ~2,000 characters of the free text, what the voice guide learns from. */
    excerpt: text("excerpt"),
    /** Topics the publication tagged the post with (Substack tags, RSS categories). */
    topics: text("topics").array().notNull(),
    /** Watchlist symbols the title or text mentions, plus $cashtags: the union over `tickersBySource`. */
    tickers: text("tickers").array().notNull(),
    /** What each source's latest answer mentioned, so a source re-read replaces only its own matches. */
    tickersBySource: jsonb("tickers_by_source").$type<Record<string, string[]>>().notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_posts_url_key").on(t.urlKey), index("content_posts_published").on(t.publishedAt)],
);
export type SilverContentPost = typeof contentPosts.$inferSelect;

/** What a draft was built from, so Thierry sees why it exists. */
export type DraftInputs = {
  symbol: string;
  companyName: string | null;
  news: { id: string; title: string; url: string; publisher: string | null; publishedAt: string | null } | null;
  /** The stored judgment that made this news worth a post (copied here so gold can show it). */
  worthJudgmentId: string | null;
  worth: { probability: number; citedSentence: string | null } | null;
  /** The catalyst that made this news a post: it moves a driver in the thesis's favour. */
  catalyst?: { id: string; direction: string; probability: number; reason: string | null } | null;
  thesis: { id: string; author: string; summary: string } | null;
  driver: { id: string; name: string } | null;
  /** The Idea the draft tells (drafts made from the Ideas table); null on older, news-made drafts. */
  idea?: { id: string; title: string; angle: string; sources: IdeaSourceRef[] } | null;
  /** Null until driver data charts exist; the UI says so. */
  chart: { title: string; url: string } | null;
};

/** One exhibit of a draft article: data copied from gold at generation time, so the preview never drifts. */
export type DraftChart = {
  title: string;
  unit: string | null;
  period: "annual" | "quarterly" | "yearly" | "market";
  points: { date: string; value: number }[];
  sources: string[];
  /** What it shows: the price, or a thesis driver. */
  kind: "price" | "driver";
  driverId: string | null;
};

/**
 * One draft text per (generation, format). A generation is one LLM call (one bronze row) producing every format.
 * Natural key: (generation bronze id, format). `version` counts generations for the same (symbol, news, format).
 */
export const contentDrafts = silver.table(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationBronzeId: uuid("generation_bronze_id").notNull(),
    symbol: text("symbol").notNull(),
    /** Stable key of the inputs (`idea:<id>`, a news id on older drafts). */
    inputKey: text("input_key").notNull(),
    /** The Idea it tells (silver.content_ideas.id); null on drafts made before Ideas existed. */
    ideaId: uuid("idea_id"),
    format: contentFormatEnum("format").notNull(),
    /** The account it is written for (its voice); null for drafts written before accounts existed. */
    accountId: text("account_id"),
    version: integer("version").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    inputs: jsonb("inputs").$type<DraftInputs>().notNull(),
    /** Exhibits of a Substack article, data snapshot taken at generation time. */
    charts: jsonb("charts").$type<DraftChart[]>(),
    /** Publishing slot: the day's drafts are spread over 24 h until the next collection. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: draftStatusEnum("status").notNull().default("draft"),
    statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
    /** Link of the published post, when Thierry pasted it on "Mark posted". */
    postedUrl: text("posted_url"),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_drafts_natural_key").on(t.generationBronzeId, t.format, t.accountId),
    index("content_drafts_symbol_input").on(t.symbol, t.inputKey, t.format),
  ],
);
export type SilverContentDraft = typeof contentDrafts.$inferSelect;

/**
 * An account we write for: one channel x one owner (Thierry himself, his fund Duality, the Dualis brand).
 * Several per channel (Thierry's LinkedIn and the fund's page). Sources: `repo` (data/content-accounts.json), `console`.
 * Natural key: `<channel>:<handle>`.
 */
export const contentAccounts = silver.table("content_accounts", {
  id: text("id").primaryKey(),
  channel: channelKindEnum("channel").notNull(),
  owner: text("owner").$type<"thierry" | "duality" | "dualis">().notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  handle: text("handle").notNull(),
  /** Posts pasted by hand to learn the voice when the channel has no free feed (LinkedIn, X). */
  samples: text("samples").array().notNull(),
  /** Text of the owner's website (source `website`), also read by the voice guide. */
  websiteText: text("website_text"),
  active: boolean("active").notNull().default(true),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SilverContentAccount = typeof contentAccounts.$inferSelect;

/**
 * The voice of an account as a short style guide, written ONCE per set of inputs (its own posts, pasted samples,
 * the publications Thierry admires) and stored. Natural key: (account, input key = hash of the inputs).
 */
export const contentVoices = silver.table(
  "content_voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    inputKey: text("input_key").notNull(),
    guide: text("guide").notNull(),
    /** What the guide was learned from, in words ("6 posts of Analysis Paralysis, 3 Aurelion posts"). */
    basis: text("basis").notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_voices_natural_key").on(t.accountId, t.inputKey)],
);

const rebuiltAt = timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow();

/** Library: one row per post, joined with its publication. Same id as silver. */
export const goldContentLibrary = gold.table(
  "content_library",
  {
    id: uuid("id").primaryKey(),
    url: text("url").notNull(),
    publicationHost: text("publication_host").notNull(),
    publicationName: text("publication_name").notNull(),
    publicationKind: text("publication_kind").notNull(),
    format: text("format").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    audience: text("audience"),
    wordCount: integer("word_count"),
    imageUrl: text("image_url"),
    topics: text("topics").array().notNull(),
    tickers: text("tickers").array().notNull(),
    sources: text("sources").array().notNull(),
    /** Own articles only: where the website's research portal files it ("coverage" | "primer" | "memo"), judged once. */
    researchCategory: text("research_category"),
    /** Own articles only: the photo behind the website's report cover (cover-photos dimension), its credit line and Commons page. */
    coverPhotoUrl: text("cover_photo_url"),
    coverPhotoCredit: text("cover_photo_credit"),
    coverPhotoLink: text("cover_photo_link"),
    rebuiltAt,
  },
  (t) => [index("gold_content_library_published").on(t.publishedAt)],
);
export type GoldContentPost = typeof goldContentLibrary.$inferSelect;

/** Publications with their health: last fetch per source, posts held, latest post. */
export const goldContentPublications = gold.table("content_publications", {
  host: text("host").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  author: text("author"),
  description: text("description"),
  posts: integer("posts").notNull(),
  latestPostAt: timestamp("latest_post_at", { withTimezone: true }),
  /** Per source: status of its latest answer ("ok" | "failed") and the error when failed. */
  sourceHealth: jsonb("source_health").$type<Record<string, { status: "ok" | "failed"; error: string | null; at: string }>>().notNull(),
  rebuiltAt,
});
export type GoldContentPublication = typeof goldContentPublications.$inferSelect;

/** Drafts queue: the latest version per (symbol, input, format). Same id as silver. */
export const goldContentDrafts = gold.table(
  "content_drafts",
  {
    id: uuid("id").primaryKey(),
    symbol: text("symbol").notNull(),
    inputKey: text("input_key").notNull(),
    ideaId: uuid("idea_id"),
    format: text("format").notNull(),
    accountId: text("account_id"),
    accountName: text("account_name"),
    version: integer("version").notNull(),
    title: text("title"),
    /** Body as it will be published, disclaimer included. */
    body: text("body").notNull(),
    inputs: jsonb("inputs").$type<DraftInputs>().notNull(),
    charts: jsonb("charts").$type<DraftChart[]>(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: text("status").notNull(),
    statusAt: timestamp("status_at", { withTimezone: true }).notNull(),
    postedUrl: text("posted_url"),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_content_drafts_created").on(t.createdAt)],
);
export type GoldContentDraft = typeof goldContentDrafts.$inferSelect;

/** Accounts as Channels shows them, with the latest voice guide. */
export const goldContentAccounts = gold.table("content_accounts", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  handle: text("handle").notNull(),
  samples: integer("samples").notNull(),
  voiceGuide: text("voice_guide"),
  voiceBasis: text("voice_basis"),
  voiceAt: timestamp("voice_at", { withTimezone: true }),
  sources: text("sources").array().notNull(),
  rebuiltAt,
});
export type GoldContentAccount = typeof goldContentAccounts.$inferSelect;

/**
 * One URL per channel, the one the public site links to ("our Substack"): derived from gold.content_accounts
 * (a Dualis account wins, then Thierry's). Kept for the site (`site/src/lib/queries.ts`).
 */
export const goldContentChannels = gold.table("content_channels", {
  kind: text("kind").primaryKey(),
  url: text("url").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  rebuiltAt,
});




/**
 * Every WhatsApp message the content dimensions queued (app.whatsapp_outbox), and why: a draft at its slot, a new
 * version after Thierry's feedback, the publish link after his OK, an ack, a thesis alert. Natural key: the bronze
 * row that decided it (re-promoting never queues twice).
 */
export const contentMessages = silver.table(
  "content_messages",
  {
    outboxId: uuid("outbox_id").primaryKey(),
    bronzeId: uuid("bronze_id").notNull(),
    purpose: text("purpose").$type<"draft" | "version" | "publish" | "ack" | "alert" | "baseline">().notNull(),
    draftId: uuid("draft_id"),
    transitionId: text("transition_id"),
    recipient: text("recipient").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sources: text("sources").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_messages_bronze").on(t.bronzeId), index("content_messages_draft").on(t.draftId)],
);

/**
 * Thierry's answers on WhatsApp to a draft, one row per inbound message (natural key: its WhatsApp id), handled once:
 * the judged intent (approve / change / dismiss / other), the new version or the message it led to.
 */
export const contentReplies = silver.table("content_replies", {
  waMessageId: text("wa_message_id").primaryKey(),
  draftId: uuid("draft_id"),
  intent: text("intent").$type<"approve" | "change" | "dismiss" | "other" | "no-draft">().notNull(),
  judgmentId: uuid("judgment_id"),
  newDraftId: uuid("new_draft_id"),
  outboxId: uuid("outbox_id"),
  sources: text("sources").array().notNull(),
  bronzeIds: uuid("bronze_ids").array().notNull(),
  handledAt: timestamp("handled_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ideas (Kevin 2026-11-06): what Dualis could publish next, proposed once a day by Claude from the analysis objects
 * (Signal Changes, Evidence, Narrative Drivers, Fair Values, Research Reports) and the publication history, then scored
 * per channel x format. A draft is made from an Idea on request (the Create draft button).
 */
export const IDEA_SOURCE_KINDS = ["signal", "change", "evidence", "driver", "fair-value", "report"] as const;
export type IdeaSourceKind = (typeof IDEA_SOURCE_KINDS)[number];
/** What an Idea rests on: `ref` = `<kind>:<id>` as offered to the model, `label` = what it says in words. */
export type IdeaSourceRef = { kind: IdeaSourceKind; ref: string; symbol: string | null; label: string };
/** How well an Idea fits one channel x format (0-100), and why. */
export type IdeaScore = { format: string; score: number; why: string };
export type DraftRequestStatus = "pending" | "done" | "failed";
export type IdeaRequest = { id: string; format: string; status: DraftRequestStatus; requestedAt: string; draftId: string | null; error: string | null };

/** One Idea. Natural key: (generation bronze id, rank). */
export const contentIdeas = silver.table(
  "content_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationBronzeId: uuid("generation_bronze_id").notNull(),
    rank: integer("rank").notNull(),
    /** UTC day of the generation (YYYY-MM-DD). */
    day: text("day").notNull(),
    /** The ticker it is about; null for an idea across tickers. */
    symbol: text("symbol"),
    /** ONE plain sentence: the idea. */
    title: text("title").notNull(),
    /** Why it is worth a post now, one or two sentences. */
    angle: text("angle").notNull(),
    sourceRefs: jsonb("source_refs").$type<IdeaSourceRef[]>().notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_ideas_natural_key").on(t.generationBronzeId, t.rank), index("content_ideas_day").on(t.day)],
);
export type SilverContentIdea = typeof contentIdeas.$inferSelect;

/** Score of one Idea on one channel x format. Natural key: (idea, format); made once. */
export const contentIdeaScores = silver.table(
  "content_idea_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id").notNull(),
    format: contentFormatEnum("format").notNull(),
    score: integer("score").notNull(),
    why: text("why").notNull(),
    model: text("model").notNull(),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_idea_scores_natural_key").on(t.ideaId, t.format)],
);

/**
 * Thierry asks for a draft of an Idea on one channel x format (console button, source `console`). The content-drafts
 * dimension writes it and marks the request done (or failed, with the reason). One pending request per (idea, format).
 */
export const contentDraftRequests = silver.table(
  "content_draft_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id").notNull(),
    format: contentFormatEnum("format").notNull(),
    status: text("status").$type<DraftRequestStatus>().notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    draftId: uuid("draft_id"),
    error: text("error"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
  },
  (t) => [
    index("content_draft_requests_idea").on(t.ideaId),
    uniqueIndex("content_draft_requests_one_pending").on(t.ideaId, t.format).where(sql`status = 'pending'`),
  ],
);
export type SilverDraftRequest = typeof contentDraftRequests.$inferSelect;

/** The Ideas table: the last 14 days of Ideas, best score first within a day. Same id as silver. */
export const goldContentIdeas = gold.table(
  "content_ideas",
  {
    id: uuid("id").primaryKey(),
    day: text("day").notNull(),
    rank: integer("rank").notNull(),
    symbol: text("symbol"),
    companyName: text("company_name"),
    title: text("title").notNull(),
    angle: text("angle").notNull(),
    sourceRefs: jsonb("source_refs").$type<IdeaSourceRef[]>().notNull(),
    /** Every channel x format scored, best first. */
    scores: jsonb("scores").$type<IdeaScore[]>().notNull(),
    bestFormat: text("best_format"),
    bestScore: integer("best_score"),
    /** Draft requests, newest first. */
    requests: jsonb("requests").$type<IdeaRequest[]>().notNull(),
    draftCount: integer("draft_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_content_ideas_day").on(t.day)],
);
export type GoldContentIdea = typeof goldContentIdeas.$inferSelect;

/**
 * Publication history of Dualis across channels (one inbox of what went out): Thierry's own Substack posts (feed) and
 * every draft marked posted (console or WhatsApp). The Ideas read it so they do not repeat a recent post.
 * id = `post:<silver post id>` or `draft:<draft id>`.
 */
export const goldContentPublished = gold.table(
  "content_published",
  {
    id: text("id").primaryKey(),
    format: text("format").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    tickers: text("tickers").array().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    /** Where we learned it: "substack" (his feed), "console" / "whatsapp" (marked posted). */
    source: text("source").notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_content_published_at").on(t.publishedAt)],
);
export type GoldContentPublished = typeof goldContentPublished.$inferSelect;

/** bytea: Neon over HTTP hands back `\\x<hex>`, node-postgres / PGlite a byte array; both read as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  fromDriver: (v) => (typeof v === "string" ? Buffer.from(v.startsWith("\\x") ? v.slice(2) : v, "hex") : Buffer.from(v)),
});

/**
 * Visuals of an Idea, shared by every draft made from it (Kevin 2026-11-06: each draft carries an image or a video):
 * `chart` (the Note chart, skill breaking-chart), `x-chart` (the same chart, professional, for X posts: skill x-post), `montage` (16:9 card: the idea, the chart, the mark),
 * `video` (the same card, the line drawing itself, MP4) and `capture` (a screenshot of the news the idea cites).
 * Rendered at $0 in GitHub Actions. The file itself sits here once (bytea); bronze keeps what was rendered from and
 * its size, gold the list the console shows (no bytes): `/api/visuals/<id>` streams the file. Natural key: (idea, kind, version).
 */
export const VISUAL_KINDS = ["montage", "video", "chart", "x-chart", "capture"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const contentVisuals = silver.table(
  "content_visuals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id").notNull(),
    kind: text("kind").$type<VisualKind>().notNull(),
    /** Render version (`VISUALS_VERSION`): a new look renders every Idea again once. */
    version: text("version").notNull(),
    status: text("status").$type<"ok" | "failed">().notNull(),
    error: text("error"),
    mime: text("mime"),
    width: integer("width"),
    height: integer("height"),
    file: bytea("file"),
    sizeBytes: integer("size_bytes"),
    /** The page a capture shows. */
    sourceUrl: text("source_url"),
    /** Credit line ("Capture of reuters.com", "Prices: Yahoo Finance"). */
    caption: text("caption"),
    sources: text("sources").array().notNull(),
    bronzeIds: uuid("bronze_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_visuals_natural_key").on(t.ideaId, t.kind, t.version)],
);

/** What the console lists per Idea (latest version per kind), without the file. Same id as silver. */
export const goldContentVisuals = gold.table(
  "content_visuals",
  {
    id: uuid("id").primaryKey(),
    ideaId: uuid("idea_id").notNull(),
    kind: text("kind").$type<VisualKind>().notNull(),
    status: text("status").$type<"ok" | "failed">().notNull(),
    error: text("error"),
    mime: text("mime"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    sourceUrl: text("source_url"),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    rebuiltAt,
  },
  (t) => [index("gold_content_visuals_idea").on(t.ideaId)],
);
export type GoldContentVisual = typeof goldContentVisuals.$inferSelect;
