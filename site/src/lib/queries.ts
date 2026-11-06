import { cache } from "react";
import { getSql } from "./db";
import type { ResearchCategory } from "./model";

/** One piece Thierry PUBLISHED on his Substack (gold.content_library, his own publications, articles only). */
export type Publication = {
  id: string;
  url: string;
  title: string;
  subtitle: string | null;
  publishedAt: string | null;
  audience: string | null;
  wordCount: number | null;
  tickers: string[];
  topics: string[];
  /** The portal shelf, filed once by the collector; null until it ran on this post. */
  category: ResearchCategory | null;
  /** The photo behind the cover (the company or its industry, Wikimedia Commons), its credit and Commons page; null until picked. */
  photo: { url: string; credit: string; link: string } | null;
};

/**
 * Only what Thierry published, newest first. The site never lists watchlist names he has not written about
 * (Thierry 2026-11-04: "the thing that's good about Aurelion is that they don't have all that stuff").
 */
export const getPublications = cache(async (): Promise<Publication[]> => {
  const rows = await getSql()`
    select id, url, title, subtitle, published_at, audience, word_count, tickers, topics, research_category,
      cover_photo_url, cover_photo_credit, cover_photo_link
    from gold.content_library
    where publication_kind = 'own' and format = 'substack-article'
    order by published_at desc nulls last, title`;
  return rows.map((r) => ({
    id: String(r.id),
    url: String(r.url),
    title: String(r.title),
    subtitle: (r.subtitle as string | null) || null,
    publishedAt: r.published_at === null ? null : new Date(r.published_at as string).toISOString(),
    audience: r.audience as string | null,
    wordCount: r.word_count === null ? null : Number(r.word_count),
    tickers: (r.tickers as string[]) ?? [],
    topics: (r.topics as string[]) ?? [],
    category: (r.research_category as ResearchCategory | null) ?? null,
    photo: r.cover_photo_url ? { url: String(r.cover_photo_url), credit: String(r.cover_photo_credit), link: String(r.cover_photo_link) } : null,
  }));
});

/** Thierry's Substack, as he set it in the console (Content > Channels). Null until he sets it. */
export const getSubstackUrl = cache(async (): Promise<string | null> => {
  const rows = await getSql()`select url from gold.content_channels where kind = 'substack'`;
  return rows.length ? String(rows[0].url) : null;
});
