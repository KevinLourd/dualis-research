/**
 * Pure parsers for the two free Substack sources, so promotion and tests share them.
 * Both turn one raw answer into PostObservations: what ONE source says about each post.
 */

export type PostObservation = {
  url: string;
  urlKey: string;
  format: "substack-article";
  title: string;
  subtitle: string | null;
  author: string | null;
  publishedAt: Date | null;
  audience: string | null;
  wordCount: number | null;
  imageUrl: string | null;
  topics: string[];
  /** First ~2,000 characters of the free text (voice learning). */
  excerpt: string | null;
  /** Plain text the ticker matcher reads (title, subtitle, description, free text). Not stored in silver. */
  text: string;
};

const EXCERPT_CHARS = 2000;

export type FeedMeta = { name: string | null; description: string | null };

/** Canonical form of a post URL: no scheme, no www, no query, no fragment, no trailing slash, lower case. */
export function urlKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

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

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Inner text of the first <tag>, CDATA unwrapped, entities decoded. */
function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  const inner = m[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(inner);
}

function allTags(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  return [...xml.matchAll(re)].map((m) => {
    const inner = m[1].trim();
    const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    return (cdata ? cdata[1] : decodeEntities(inner)).trim();
  });
}

function blank(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function date(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** RSS 2.0 feed (Substack's /feed). Items without a link are skipped: a post needs an address. */
export function parseRss(xml: string): { meta: FeedMeta; posts: PostObservation[] } {
  const channel = xml.split(/<item[\s>]/i)[0];
  const meta = { name: blank(tag(channel, "title")), description: blank(tag(channel, "description")) };
  const posts: PostObservation[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const link = blank(tag(item, "link")) ?? blank(tag(item, "guid"));
    const title = blank(tag(item, "title"));
    if (!link || !title || !/^https?:\/\//.test(link)) continue;
    const description = blank(tag(item, "description"));
    const content = tag(item, "content:encoded") ?? "";
    const enclosure = item.match(/<enclosure[^>]*url="([^"]+)"/i)?.[1] ?? null;
    posts.push({
      url: link,
      urlKey: urlKey(link),
      format: "substack-article",
      title: stripHtml(title),
      subtitle: description ? stripHtml(description) : null,
      author: blank(tag(item, "dc:creator")),
      publishedAt: date(tag(item, "pubDate")),
      audience: null,
      wordCount: null,
      imageUrl: enclosure ? decodeEntities(enclosure) : null,
      topics: allTags(item, "category").filter(Boolean),
      excerpt: blank(stripHtml(content).slice(0, EXCERPT_CHARS)),
      text: [title, description ?? "", stripHtml(content)].join("\n"),
    });
  }
  return { meta, posts };
}

type ArchivePost = {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  canonical_url?: string;
  post_date?: string | null;
  audience?: string | null;
  type?: string;
  wordcount?: number | null;
  cover_image?: string | null;
  truncated_body_text?: string | null;
  postTags?: { name?: string }[];
  publishedBylines?: { name?: string }[];
};

/** Substack's public archive JSON (/api/v1/archive): adds audience (free / paid), word count and tags. */
export function parseArchive(payload: unknown): PostObservation[] {
  if (!Array.isArray(payload)) throw new Error("archive answer is not a list");
  const posts: PostObservation[] = [];
  for (const p of payload as ArchivePost[]) {
    const url = blank(p.canonical_url);
    const title = blank(p.title);
    if (!url || !title) continue;
    const subtitle = blank(p.subtitle) ?? blank(p.description);
    posts.push({
      url,
      urlKey: urlKey(url),
      format: "substack-article",
      title,
      subtitle,
      author: blank((p.publishedBylines ?? []).map((b) => b.name ?? "").filter(Boolean).join(", ")),
      publishedAt: date(p.post_date),
      audience: blank(p.audience),
      wordCount: typeof p.wordcount === "number" && p.wordcount > 0 ? p.wordcount : null,
      imageUrl: blank(p.cover_image),
      topics: (p.postTags ?? []).map((t) => t.name?.trim() ?? "").filter(Boolean),
      excerpt: blank((p.truncated_body_text ?? "").slice(0, EXCERPT_CHARS)),
      text: [title, subtitle ?? "", p.truncated_body_text ?? ""].join("\n"),
    });
  }
  return posts;
}

export type TickerRef = { symbol: string; name: string | null; aliases: string[] };

const LEGAL_SUFFIX = /\b(inc|corp|corporation|co|company|ltd|limited|plc|sa|ag|nv|se|kk)\b\.?/gi;
const GROUP_WORDS = /\b(holdings?|group|the)\b/gi;
const clean = (s: string) => s.replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Name to match a company by: "Boot Barn Holdings, Inc." -> "Boot Barn". When that leaves one word, a common word
 * would match everywhere ("Enterprise"), so the name keeps its group word: "Enterprise Group".
 */
export function shortName(name: string): string {
  const legal = clean(name.replace(LEGAL_SUFFIX, " "));
  const short = clean(legal.replace(GROUP_WORDS, " "));
  return short.includes(" ") || short === legal ? short : legal;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tickers a post mentions: every $cashtag (any company), plus watchlist symbols written in full (case-sensitive),
 * their short company name or an alias (4+ characters; a one-word name only when capitalized).
 */
export function mentionedTickers(text: string, watchlist: TickerRef[]): string[] {
  const found = new Set<string>();
  const bySymbol = new Map(watchlist.map((t) => [t.symbol.toUpperCase(), t.symbol]));
  for (const m of text.matchAll(/\$([A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,2})?)\b/g)) {
    found.add(bySymbol.get(m[1]) ?? m[1]);
  }
  for (const t of watchlist) {
    const terms: { term: string; flags: string }[] = [];
    if (t.symbol.length >= 3) terms.push({ term: t.symbol, flags: "" });
    for (const n of [t.name ? shortName(t.name) : "", ...t.aliases]) {
      // One word ("Monro") must be written as a name, capitalized; several words match in any case.
      if (n.trim().length >= 4) terms.push({ term: n.trim(), flags: n.includes(" ") ? "i" : "" });
    }
    if (terms.some(({ term, flags }) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}($|[^\\p{L}\\p{N}])`, `u${flags}`).test(text))) {
      found.add(t.symbol);
    }
  }
  return [...found].sort();
}
