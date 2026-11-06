/**
 * Pure news helpers (no database, no network): RSS parsing, query building, canonical keys and the dedup that
 * merges one article seen by several sources into ONE item carrying every source tag.
 * Ported from Thierry's legacy digest and the reverted Python collector (PR #16).
 */

export type MatchKind = "symbol" | "name" | "alias";

/** One article as one source returned it for one ticker, before dedup. */
export type RawArticle = {
  source: string;
  bronzeId: string;
  symbol: string;
  matchKind: MatchKind;
  matchedTerm: string;
  title: string;
  url: string;
  publisher: string | null;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Markets and query terms
// ---------------------------------------------------------------------------

/** "6758.T" -> "6758"; "MNRO" -> "MNRO". */
export function tickerBase(symbol: string): string {
  const i = symbol.lastIndexOf(".");
  return i === -1 ? symbol : symbol.slice(0, i);
}

/** Google News edition per watchlist market (hl=en-XX, gl=XX, ceid=XX:en). Others read the US edition. */
export const GOOGLE_REGION: Record<string, string> = { US: "US", CA: "CA", AU: "AU", HK: "HK", UK: "GB" };

// Only true legal-form tokens: descriptive words (Group, Holdings) keep a name distinctive
// ("ADF Group Inc." must not collapse to "ADF").
const LEGAL_SUFFIX = /[\s,]+(?:inc|corp|corporation|co|ltd|limited|llc|plc|lp|llp|ag|sa|se|nv|co\.,?\s*ltd\.?)\.?$/i;

/** "Monro, Inc." -> "Monro"; "Capstone Energy Plus, Inc. Common Stock" -> "Capstone Energy Plus". */
export function cleanCompanyName(name: string): string {
  let out = name.trim().replace(/\s+common stock$/i, "");
  let prev: string | null = null;
  while (out !== prev && out.includes(" ")) {
    prev = out;
    out = out.replace(LEGAL_SUFFIX, "").trim();
  }
  return out || name.trim();
}

export type NewsQuery = { kind: "name" | "alias"; term: string; q: string };

/**
 * Exact-phrase Google News queries: the company name, then each alias. A one-word alias is too broad alone
 * ("Conrad"), so it is ANDed with the ticker. `when:7d` keeps each answer to the last week.
 */
export function googleQueries(symbol: string, name: string, aliases: readonly string[]): NewsQuery[] {
  const clean = cleanCompanyName(name);
  const seen = new Set([clean.toLowerCase()]);
  const out: NewsQuery[] = [{ kind: "name", term: clean, q: `"${clean}" when:7d` }];
  for (const raw of aliases) {
    const a = raw.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    const q = a.split(/\s+/).length === 1 ? `"${a}" ${tickerBase(symbol)} when:7d` : `"${a}" when:7d`;
    out.push({ kind: "alias", term: a, q });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSS
// ---------------------------------------------------------------------------

export type RssItem = {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
  /** <source> element text (Google News: the publisher). */
  source: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decodeEntities(raw);
}

/** Strips HTML tags and collapses spaces (RSS descriptions often carry markup). */
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Throws when the text is not an RSS feed, so a broken answer is never read as "no news". */
export function parseRss(xml: string): RssItem[] {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) {
    throw new Error(`not an RSS feed: ${xml.slice(0, 120).replace(/\s+/g, " ")}`);
  }
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    items.push({ title, link, pubDate: tag(block, "pubDate"), description: tag(block, "description"), source: tag(block, "source") });
  }
  return items;
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A syndicated title signed with its site, e.g. "... Playboy shares By Investing.com". */
const SIGNED_BY_SITE = /\s+by\s+[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|news)(?:\.\w{2})?$/i;

/**
 * Google News titles end with " - Publisher", and syndicated copies add " By Investing.com": drop both so the title
 * matches the other sources' and the other editions'.
 */
export function stripPublisherSuffix(title: string, publisher: string | null): string {
  let out = title.trim();
  if (publisher) {
    const suffix = ` - ${publisher}`;
    if (out.endsWith(suffix)) out = out.slice(0, -suffix.length).trim();
  }
  return out.replace(SIGNED_BY_SITE, "").trim();
}

// ---------------------------------------------------------------------------
// Canonical keys
// ---------------------------------------------------------------------------

const TRACKING_PARAM = /^(utm_|guccounter|guce_|ncid|cmpid|fbclid|gclid|mc_|\.tsrc$|tsrc$|ref$|src$|oc$)/i;

/** "https://www.a.com/x/?utm_source=rss#top" -> "a.com/x". Two links with the same key are the same article. */
export function canonicalUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${query}`;
}

/** Near-identical titles share a key: case, accents width, punctuation and spacing are ignored. */
export function titleKey(title: string): string {
  return title
    .replace(SIGNED_BY_SITE, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Aggregator links (redirects) lose to a publisher's own link when choosing the one to show. */
const AGGREGATOR_HOSTS = ["news.google.com", "finnhub.io"];

export function linkRank(url: string): number {
  try {
    const host = new URL(url).hostname;
    return AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? 1 : 0;
  } catch {
    return 2;
  }
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/** Two articles with the same title are the same story only if published within this window. */
export const TITLE_MATCH_WINDOW_MS = 3 * 24 * 3600 * 1000;

/** The silver shape the dedup works on. `id` is null for an item this run creates. */
export type ItemState = {
  id: string | null;
  title: string;
  titleKey: string;
  url: string;
  urls: string[];
  urlKeys: string[];
  publisher: string | null;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  sources: string[];
  bronzeIds: string[];
  /** Set when this run changed the item. */
  touched: boolean;
};

export type MentionState = {
  item: ItemState;
  symbol: string;
  matchKind: MatchKind;
  matchedTerm: string;
  sources: string[];
  bronzeIds: string[];
};

function sameStory(item: ItemState, a: RawArticle, urlKey: string, tKey: string): boolean {
  if (item.urlKeys.includes(urlKey)) return true;
  if (item.titleKey !== tKey || tKey.length < 12) return false;
  if (!item.publishedAt || !a.publishedAt) return true;
  return Math.abs(item.publishedAt.getTime() - a.publishedAt.getTime()) <= TITLE_MATCH_WINDOW_MS;
}

function addSource(sources: string[], bronzeIds: string[], source: string, bronzeId: string) {
  const i = sources.indexOf(source);
  if (i === -1) {
    sources.push(source);
    bronzeIds.push(bronzeId);
  } else {
    bronzeIds[i] = bronzeId;
  }
}

/**
 * Merges this run's raw articles into the existing items: same canonical link OR same title published within
 * 3 days = the same article. Every source that saw it is kept (never first-found). Mutates and returns `items`.
 */
export function mergeArticles(
  items: ItemState[],
  articles: RawArticle[],
): { items: ItemState[]; mentions: MentionState[] } {
  const mentions = new Map<string, MentionState>();
  for (const a of articles) {
    const urlKey = canonicalUrl(a.url);
    const tKey = titleKey(a.title);
    let item = items.find((i) => sameStory(i, a, urlKey, tKey));
    if (!item) {
      item = {
        id: null,
        title: a.title,
        titleKey: tKey,
        url: a.url,
        urls: [],
        urlKeys: [],
        publisher: null,
        summary: null,
        imageUrl: null,
        publishedAt: null,
        sources: [],
        bronzeIds: [],
        touched: true,
      };
      items.push(item);
    }
    item.touched = true;
    if (!item.urlKeys.includes(urlKey)) {
      item.urls.push(a.url);
      item.urlKeys.push(urlKey);
    }
    if (linkRank(a.url) < linkRank(item.url)) item.url = a.url;
    item.publisher ??= a.publisher;
    if (a.summary && (!item.summary || a.summary.length > item.summary.length)) item.summary = a.summary;
    item.imageUrl ??= a.imageUrl;
    if (a.publishedAt && (!item.publishedAt || a.publishedAt < item.publishedAt)) item.publishedAt = a.publishedAt;
    addSource(item.sources, item.bronzeIds, a.source, a.bronzeId);

    const key = `${items.indexOf(item)}\u0000${a.symbol}\u0000${a.matchKind}\u0000${a.matchedTerm}`;
    const m = mentions.get(key) ?? {
      item,
      symbol: a.symbol,
      matchKind: a.matchKind,
      matchedTerm: a.matchedTerm,
      sources: [],
      bronzeIds: [],
    };
    addSource(m.sources, m.bronzeIds, a.source, a.bronzeId);
    mentions.set(key, m);
  }
  return { items, mentions: [...mentions.values()] };
}
