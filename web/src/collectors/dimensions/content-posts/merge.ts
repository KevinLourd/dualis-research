import type { PostObservation } from "./parse";

/** Silver shape of a post before it gets an id. */
export type PostState = Omit<PostObservation, "text"> & {
  publicationHost: string;
  tickers: string[];
  tickersBySource: Record<string, string[]>;
  sources: string[];
  bronzeIds: string[];
};

/** Which source wins a field both give: the archive JSON is structured, RSS is the fallback. */
const PRIORITY = ["substack-archive", "substack-rss"];
const rank = (s: string) => {
  const i = PRIORITY.indexOf(s);
  return i === -1 ? PRIORITY.length : i;
};

/**
 * Applies one source's observation of a post to its silver state (pure).
 * Provenance rule: a post several sources list is ONE row carrying EVERY source tag, never first-found; the source's
 * latest bronze id replaces its previous one. A field takes the value of the best-ranked source that has one;
 * topics are the union of what every source said; tickers the union of each source's LATEST matches.
 */
export function mergePost(
  existing: PostState | null,
  obs: PostObservation,
  ctx: { source: string; bronzeId: string; publicationHost: string; tickers: string[] },
): PostState {
  const { text: _text, ...fields } = obs;
  void _text;
  if (!existing) {
    return {
      ...fields,
      publicationHost: ctx.publicationHost,
      tickers: [...ctx.tickers].sort(),
      tickersBySource: { [ctx.source]: ctx.tickers },
      sources: [ctx.source],
      bronzeIds: [ctx.bronzeId],
    };
  }
  const i = existing.sources.indexOf(ctx.source);
  const sources = [...existing.sources];
  const bronzeIds = [...existing.bronzeIds];
  if (i === -1) {
    sources.push(ctx.source);
    bronzeIds.push(ctx.bronzeId);
  } else {
    bronzeIds[i] = ctx.bronzeId;
  }
  // Does this source outrank every other source already on the row? Then its non-null values win.
  const others = existing.sources.filter((s) => s !== ctx.source);
  const wins = others.every((s) => rank(ctx.source) <= rank(s));
  const tickersBySource = { ...existing.tickersBySource, [ctx.source]: ctx.tickers };
  const pick = <T,>(mine: T | null, theirs: T | null): T | null => (mine === null ? theirs : theirs === null || wins ? mine : theirs);
  return {
    url: wins ? fields.url : existing.url,
    urlKey: existing.urlKey,
    format: existing.format,
    title: wins ? fields.title : existing.title,
    subtitle: pick(fields.subtitle, existing.subtitle),
    author: pick(fields.author, existing.author),
    publishedAt: pick(fields.publishedAt, existing.publishedAt),
    audience: pick(fields.audience, existing.audience),
    wordCount: pick(fields.wordCount, existing.wordCount),
    imageUrl: pick(fields.imageUrl, existing.imageUrl),
    // The longest free text wins: RSS carries the body, the archive only a truncated preview.
    excerpt: (fields.excerpt?.length ?? 0) >= (existing.excerpt?.length ?? 0) ? fields.excerpt : existing.excerpt,
    topics: union(existing.topics, fields.topics),
    tickers: union([], Object.values(tickersBySource).flat()),
    tickersBySource,
    publicationHost: existing.publicationHost,
    sources,
    bronzeIds,
  };
}

function union(a: string[], b: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of [...a, ...b]) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort((x, y) => x.localeCompare(y));
}
