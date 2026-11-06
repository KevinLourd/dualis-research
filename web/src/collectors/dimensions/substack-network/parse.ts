import type { BronzeFetch } from "@/db/schema/bronze";
import { MAX_CANDIDATES, MIN_INBOUND, NICHE } from "./seeds";

/**
 * Subjects of the crawl, one kind per Substack endpoint (all served on any publication's own domain, see GATEWAYS):
 * - `recs:<pub id>`     -> /api/v1/recommendations/from/<id>
 * - `profile:<handle>`  -> /api/v1/user/<handle>/public_profile (subscriber count, user id, publications)
 * - `posts:<user id>`   -> /api/v1/profile/posts?profile_user_id=<id> (the author's latest posts, every publication)
 */
export type SubjectKind = "recs" | "profile" | "posts";
const KINDS: readonly SubjectKind[] = ["recs", "profile", "posts"];
export const subject = (kind: SubjectKind, value: string) => `${kind}:${value}`;
export function parseSubject(s: string): { kind: SubjectKind; value: string } {
  const i = s.indexOf(":");
  const kind = s.slice(0, i) as SubjectKind;
  if (i === -1 || !KINDS.includes(kind)) throw new Error(`not a substack-network subject: ${s}`);
  return { kind, value: s.slice(i + 1) };
}

/** A publication as Substack describes it in a recommendation or a profile. */
export type PublicationObservation = {
  id: string;
  name: string;
  host: string;
  heroText: string | null;
  authorHandle: string | null;
  authorName: string | null;
  paymentsState: string | null;
};

type RawPublication = {
  id: number;
  author_id?: number | null;
  name?: string;
  subdomain?: string;
  custom_domain?: string | null;
  hero_text?: string | null;
  payments_state?: string | null;
  author_name?: string | null;
  author?: { handle?: string | null; name?: string | null } | null;
};

export function toPublication(p: RawPublication, fallback?: { handle?: string | null; name?: string | null }): PublicationObservation {
  return {
    id: String(p.id),
    name: p.name?.trim() || p.subdomain || String(p.id),
    host: (p.custom_domain || `${p.subdomain}.substack.com`).toLowerCase(),
    heroText: p.hero_text?.trim() || null,
    authorHandle: p.author?.handle ?? fallback?.handle ?? null,
    authorName: p.author?.name ?? p.author_name ?? fallback?.name ?? null,
    paymentsState: p.payments_state ?? null,
  };
}

/** Recommendations list -> the recommended publications. */
export function parseRecommendations(payload: unknown): PublicationObservation[] {
  if (!Array.isArray(payload)) throw new Error("recommendations answer is not a list");
  return payload
    .map((r) => (r as { recommendedPublication?: RawPublication }).recommendedPublication)
    .filter((p): p is RawPublication => !!p && typeof p.id === "number")
    .map((p) => toPublication(p));
}

export type ArchivePost = { title: string; date: string; audience: string | null; url: string | null };

/** An author's latest posts -> per publication id, newest first. */
export function parsePosts(payload: unknown): Map<string, ArchivePost[]> {
  const items = (payload as { posts?: unknown })?.posts;
  if (!Array.isArray(items)) throw new Error("profile posts answer has no posts list");
  const out = new Map<string, ArchivePost[]>();
  for (const i of items as { publication_id?: number; title?: string; post_date?: string; audience?: string; canonical_url?: string }[]) {
    if (typeof i.publication_id !== "number" || !i.post_date) continue;
    const id = String(i.publication_id);
    out.set(id, [...(out.get(id) ?? []), { title: i.title ?? "", date: i.post_date, audience: i.audience ?? null, url: i.canonical_url ?? null }]);
  }
  for (const list of out.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

/** Public profile -> subscriber count and the publications it lists. */
export function parseProfile(payload: unknown): {
  handle: string;
  name: string | null;
  userId: string | null;
  subscribers: number | null;
  publications: PublicationObservation[];
} {
  const p = payload as {
    handle?: string;
    name?: string;
    id?: number;
    subscriberCountNumber?: number;
    publicationUsers?: { publication?: RawPublication }[];
  };
  if (!p || typeof p.handle !== "string") throw new Error("profile answer has no handle");
  const subscribers = typeof p.subscriberCountNumber === "number" ? p.subscriberCountNumber : null;
  return {
    handle: p.handle,
    name: p.name ?? null,
    userId: p.id === undefined ? null : String(p.id),
    subscribers,
    // The publications this person writes (author), not the ones they only contribute to.
    publications: (p.publicationUsers ?? [])
      .map((u) => u.publication)
      .filter((x): x is RawPublication => !!x && typeof x.id === "number" && (x.author_id === undefined || x.author_id === null || x.author_id === p.id))
      .map((x) => toPublication(x, { handle: p.handle, name: p.name })),
  };
}

const ok = (f: BronzeFetch) => !f.error && f.payload !== null;
export const fetchesOf = (rows: BronzeFetch[], kind: SubjectKind) => rows.filter((f) => ok(f) && parseSubject(f.subject).kind === kind);

/** The graph this run's recommendation answers describe: every publication seen + who recommends it. */
export function graphOf(rows: BronzeFetch[]): { pubs: Map<string, PublicationObservation>; inbound: Map<string, Set<string>> } {
  const pubs = new Map<string, PublicationObservation>();
  const inbound = new Map<string, Set<string>>();
  for (const f of fetchesOf(rows, "recs")) {
    const from = parseSubject(f.subject).value;
    for (const p of parseRecommendations(f.payload)) {
      pubs.set(p.id, p);
      inbound.set(p.id, (inbound.get(p.id) ?? new Set()).add(from));
    }
  }
  return { pubs, inbound };
}

/**
 * Who the ranking considers: niche publications recommended by at least MIN_INBOUND crawled publications
 * (top MAX_CANDIDATES by inbound), plus every author we drafted a message for. Never our own.
 */
export function selectCandidates(
  pubs: { id: string; name: string; heroText: string | null; authorHandle: string | null }[],
  inbound: (id: string) => number,
  opts: { draftedHandles: Set<string>; ownId: string },
): string[] {
  const niche = pubs
    .filter((p) => p.id !== opts.ownId && inbound(p.id) >= MIN_INBOUND && NICHE.test(`${p.name} ${p.heroText ?? ""}`))
    .sort((a, b) => inbound(b.id) - inbound(a.id) || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES)
    .map((p) => p.id);
  const drafted = pubs.filter((p) => p.id !== opts.ownId && p.authorHandle && opts.draftedHandles.has(p.authorHandle)).map((p) => p.id);
  return [...new Set([...niche, ...drafted])];
}
