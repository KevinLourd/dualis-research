import { desc, eq, inArray, sql } from "drizzle-orm";
import { fetches, type BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import { activeAccounts } from "../content-accounts";
import { getJson, getText } from "../../http";
import { GATEWAYS } from "../substack-network/seeds";
import type { Dimension, PromoteResult, Source, SourceContext } from "../../types";
import { categorizeOwnArticles, categoriesByPost } from "./category";
import { mergePost, type PostState } from "./merge";
import { mentionedTickers, parseArchive, parseRss, type FeedMeta, type PostObservation, type TickerRef } from "./parse";

export const POSTS_DIMENSION = "content-posts";
export const RSS_SOURCE = "substack-rss";
export const ARCHIVE_SOURCE = "substack-archive";

/** The research publications Thierry follows (docs/references.md), read through their public Substack feeds. */
export const REFERENCE_PUBLICATIONS = [
  { host: "www.citriniresearch.com", name: "Citrini Research", author: "Citrini" },
  { host: "read.aurelionresearch.com", name: "Aurelion Research", author: "Jeremie Boyer" },
  { host: "www.archetype-research.com", name: "Archetype Capital", author: null },
  { host: "deepvaluecapitalbykyler.substack.com", name: "DeepValue Capital", author: "Kyler Johnson" },
  { host: "www.byronstreetresearch.com", name: "Liger Cub (Byron Street Research)", author: "Liger Cub" },
] as const;

const HEADERS = { "user-agent": "DualisResearch/1.0 (+https://github.com/KevinLourd/dualis-research)" };

/** Substack challenges datacenter IPs (GitHub Actions) on *.substack.com; publications' own domains pass. */
const isSubdomain = (host: string) => host.endsWith(".substack.com");

/** Substack's RSS feed: the 20 latest posts with their free text. Not reachable from CI for *.substack.com hosts. */
export const substackRss: Source = {
  name: RSS_SOURCE,
  requiredEnv: [],
  covers: (host) => !isSubdomain(host),
  fetch: (host, ctx) => getText(ctx, `https://${host}/feed`, { url: `https://${host}/feed` }, { headers: HEADERS }),
};

/**
 * Substack's public archive JSON: the same posts with audience (free / paid), word count and tags. A *.substack.com
 * publication is read through another publication's own domain (`GATEWAYS`, same API): its author's profile, then
 * the author's latest posts, kept when they belong to this publication.
 */
export const substackArchive: Source = {
  name: ARCHIVE_SOURCE,
  requiredEnv: [],
  covers: () => true,
  fetch: async (host, ctx) => {
    if (!isSubdomain(host)) {
      const url = `https://${host}/api/v1/archive?sort=new&limit=20`;
      return getJson(ctx, url, { url }, { headers: HEADERS });
    }
    const handle = host.split(".")[0];
    let last: Awaited<ReturnType<typeof getJson>> | null = null;
    for (const gateway of GATEWAYS) {
      const profileUrl = `https://${gateway}/api/v1/user/${handle}/public_profile`;
      const profile = await getJson(ctx, profileUrl, { url: profileUrl }, { headers: HEADERS });
      last = profile;
      if (profile.error) continue;
      const id = (profile.payload as { id?: number }).id;
      if (!id) return { ...profile, error: `no author id for ${handle}` };
      const postsUrl = `https://${gateway}/api/v1/profile/posts?profile_user_id=${id}&limit=20`;
      const posts = await getJson(ctx, postsUrl, { url: postsUrl, profileUrl }, { headers: HEADERS });
      last = posts;
      if (posts.error) continue;
      return posts;
    }
    return last!;
  },
};

export const contentPosts: Dimension = {
  name: POSTS_DIMENSION,
  description: "Posts of the research publications Thierry follows and his own, from their public Substack feeds.",
  sources: [substackRss, substackArchive],
  subjects: publicationHosts,
  promote: promoteContentPosts,
};

/** Reference publications + every Substack account we write for (Content > Channels, data/content-accounts.json). */
export async function publicationHosts(db: Db): Promise<string[]> {
  const hosts: string[] = REFERENCE_PUBLICATIONS.map((p) => p.host);
  for (const a of await activeAccounts(db, "substack")) {
    const host = new URL(a.url).hostname.toLowerCase();
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

export async function promoteContentPosts(db: Db, rows: BronzeFetch[], ctx?: SourceContext): Promise<PromoteResult> {
  const watchlist = await tickerRefs(db);
  const ownHosts = new Set((await publicationHosts(db)).filter((h) => !REFERENCE_PUBLICATIONS.some((p) => p.host === h)));
  const ok = rows.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const silverRowsBySource: Record<string, number> = {};

  for (const f of ok) {
    let observations: PostObservation[];
    let meta: FeedMeta = { name: null, description: null };
    if (f.source === RSS_SOURCE) ({ meta, posts: observations } = parseRss(f.payloadText ?? ""));
    else if (f.source === ARCHIVE_SOURCE) observations = parseArchive(archiveList(f.payload, f.subject));
    else throw new Error(`content-posts: no parser for source "${f.source}"`);

    await upsertPublication(db, f, meta, ownHosts.has(f.subject) ? "own" : "reference");
    await upsertPosts(db, f, observations, watchlist);
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + observations.length;
  }

  await categorizeOwnArticles(db, ctx?.complete);
  await rebuildGoldContent(db);
  return { silverRowsBySource };
}

/**
 * The archive answer as a list of this publication's posts: the archive JSON is one already; a gateway answer is
 * the author's posts on every publication, kept when they belong to this host.
 */
export function archiveList(payload: unknown, host: string): unknown {
  if (Array.isArray(payload)) return payload;
  const posts = (payload as { posts?: { canonical_url?: string }[] } | null)?.posts;
  if (!Array.isArray(posts)) return payload;
  return posts.filter((p) => {
    try {
      return new URL(p.canonical_url ?? "").hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

async function tickerRefs(db: Db): Promise<TickerRef[]> {
  const rows = await db
    .select({ symbol: gold.tickers.symbol, aliases: gold.tickers.aliases, name: gold.companyProfiles.name })
    .from(gold.tickers)
    .leftJoin(gold.companyProfiles, eq(gold.companyProfiles.symbol, gold.tickers.symbol));
  return rows.map((r) => ({ symbol: r.symbol, name: r.name, aliases: r.aliases }));
}

async function upsertPublication(db: Db, f: BronzeFetch, meta: FeedMeta, kind: "reference" | "own") {
  const ref = REFERENCE_PUBLICATIONS.find((p) => p.host === f.subject);
  const [existing] = await db.select().from(content.contentPublications).where(eq(content.contentPublications.host, f.subject));
  const sources = [...(existing?.sources ?? [])];
  const bronzeIds = [...(existing?.bronzeIds ?? [])];
  const i = sources.indexOf(f.source);
  if (i === -1) {
    sources.push(f.source);
    bronzeIds.push(f.id);
  } else bronzeIds[i] = f.id;
  const values = {
    host: f.subject,
    // The name from docs/references.md wins; the feed title names Thierry's own publication.
    name: ref?.name ?? meta.name ?? existing?.name ?? f.subject,
    kind,
    author: ref?.author ?? existing?.author ?? null,
    description: meta.description ?? existing?.description ?? null,
    sources,
    bronzeIds,
    lastSeenAt: new Date(),
  };
  await db.insert(content.contentPublications).values(values).onConflictDoUpdate({ target: content.contentPublications.host, set: values });
}

async function upsertPosts(db: Db, f: BronzeFetch, observations: PostObservation[], watchlist: TickerRef[]) {
  if (observations.length === 0) return;
  const keys = [...new Set(observations.map((o) => o.urlKey))];
  const existing = await db.select().from(content.contentPosts).where(inArray(content.contentPosts.urlKey, keys));
  const state = new Map<string, PostState>(existing.map((e) => [e.urlKey, toState(e)]));
  for (const obs of observations) {
    state.set(
      obs.urlKey,
      mergePost(state.get(obs.urlKey) ?? null, obs, {
        source: f.source,
        bronzeId: f.id,
        publicationHost: f.subject,
        tickers: mentionedTickers(obs.text, watchlist),
      }),
    );
  }
  const now = new Date();
  for (const s of state.values()) {
    if (!keys.includes(s.urlKey)) continue;
    await db
      .insert(content.contentPosts)
      .values({ ...s, lastSeenAt: now })
      .onConflictDoUpdate({
        target: content.contentPosts.urlKey,
        set: {
          url: s.url,
          title: s.title,
          subtitle: s.subtitle,
          author: s.author,
          publishedAt: s.publishedAt,
          audience: s.audience,
          wordCount: s.wordCount,
          imageUrl: s.imageUrl,
          excerpt: s.excerpt,
          topics: s.topics,
          tickers: s.tickers,
          tickersBySource: s.tickersBySource,
          sources: s.sources,
          bronzeIds: s.bronzeIds,
          lastSeenAt: now,
        },
      });
  }
}

function toState(e: content.SilverContentPost): PostState {
  return {
    url: e.url,
    urlKey: e.urlKey,
    format: "substack-article",
    title: e.title,
    subtitle: e.subtitle,
    author: e.author,
    publishedAt: e.publishedAt,
    audience: e.audience,
    wordCount: e.wordCount,
    imageUrl: e.imageUrl,
    excerpt: e.excerpt,
    topics: e.topics,
    tickers: e.tickers,
    tickersBySource: e.tickersBySource,
    publicationHost: e.publicationHost,
    sources: e.sources,
    bronzeIds: e.bronzeIds,
  };
}

/** gold.content_library + gold.content_publications, rebuilt from silver (+ the latest bronze answer per source for health). */
export async function rebuildGoldContent(db: Db) {
  const pubs = await db.select().from(content.contentPublications);
  const posts = await db.select().from(content.contentPosts);
  const pubOf = new Map(pubs.map((p) => [p.host, p]));
  const categoryOf = await categoriesByPost(db);

  const latest = await db
    .selectDistinctOn([fetches.source, fetches.subject], {
      source: fetches.source,
      subject: fetches.subject,
      error: fetches.error,
      fetchedAt: fetches.fetchedAt,
    })
    .from(fetches)
    .where(eq(fetches.dimension, POSTS_DIMENSION))
    .orderBy(fetches.source, fetches.subject, desc(fetches.fetchedAt));

  await db.transaction(async (tx) => {
    await tx.delete(content.goldContentLibrary);
    if (posts.length > 0) {
      await tx.insert(content.goldContentLibrary).values(
        posts.map((p) => {
          const pub = pubOf.get(p.publicationHost);
          return {
            id: p.id,
            url: p.url,
            publicationHost: p.publicationHost,
            publicationName: pub?.name ?? p.publicationHost,
            publicationKind: pub?.kind ?? "reference",
            format: p.format,
            title: p.title,
            subtitle: p.subtitle,
            author: p.author,
            publishedAt: p.publishedAt,
            audience: p.audience,
            wordCount: p.wordCount,
            imageUrl: p.imageUrl,
            topics: p.topics,
            tickers: p.tickers,
            sources: p.sources,
            researchCategory: categoryOf.get(p.id) ?? null,
          };
        }),
      );
    }

    await tx.delete(content.goldContentPublications);
    if (pubs.length > 0) {
      await tx.insert(content.goldContentPublications).values(
        pubs.map((p) => {
          const own = posts.filter((x) => x.publicationHost === p.host);
          const dates = own.map((x) => x.publishedAt?.getTime() ?? 0).filter(Boolean);
          const health: content.GoldContentPublication["sourceHealth"] = {};
          for (const l of latest.filter((l) => l.subject === p.host)) {
            health[l.source] = { status: l.error ? "failed" : "ok", error: l.error, at: l.fetchedAt.toISOString() };
          }
          return {
            host: p.host,
            name: p.name,
            kind: p.kind,
            author: p.author,
            description: p.description,
            posts: own.length,
            latestPostAt: dates.length ? new Date(Math.max(...dates)) : null,
            sourceHealth: health,
          };
        }),
      );
    }
  });
}

/** Number of posts per publication in silver (used by tests and the Data page counts). */
export async function countPosts(db: Db) {
  return db
    .select({ host: content.contentPosts.publicationHost, n: sql<number>`count(*)::int` })
    .from(content.contentPosts)
    .groupBy(content.contentPosts.publicationHost);
}
