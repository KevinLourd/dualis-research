import { and, eq, inArray, sql } from "drizzle-orm";
import { promoteFacts, readFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as growth from "@/db/schema/growth";
import { judgments } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { rebuildGoldAudience } from "@/growth/audience";
import type { Complete } from "@/llm/complete";
import { judge } from "@/llm/judge";
import { getJson } from "../../http";
import { isoDate } from "../../markets";
import type { Dimension, PromoteResult, Source } from "../../types";
import {
  fetchesOf,
  graphOf,
  parsePosts,
  parseProfile,
  parseRecommendations,
  parseSubject,
  type PublicationObservation,
  selectCandidates,
  subject,
} from "./parse";
import { EXCLUDED_AUTHORS, GATEWAYS, INACTIVE_AFTER_DAYS, MAX_RECOMMENDATION_FETCHES, OWN, SEEDS } from "./seeds";


export const NETWORK_DIMENSION = "substack-network";
export const SUBSTACK_SOURCE = "substack";
/** Provenance tags per Substack endpoint, kept on silver rows. */
export const TAG = { recs: "substack-recommendations", posts: "substack-posts", profile: "substack-profile" } as const;
export const FIT_SUBJECT_KIND = "substack-publication";
export const FIT_QUESTION_KEY = "reader-fit@v1";
export const FIT_CHOICES = ["yes", "partly", "no"] as const;
const FIT_WEIGHT: Record<string, number> = { yes: 1, partly: 0.5, no: 0.1 };
const UNJUDGED_WEIGHT = 0.5;
const MAX_JUDGMENTS_PER_RUN = 80;
const PARALLEL = 3;

const HEADERS = { "User-Agent": "DualisResearch/1.0 (+https://github.com/KevinLourd/dualis-research)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Per run (keyed on the run's fetch function): consecutive refusals and the next gateway to use. */
const runState = new WeakMap<typeof fetch, { inARow: number; next: number }>();

function pathOf(s: string): string {
  const { kind, value } = parseSubject(s);
  if (kind === "recs") return `/api/v1/recommendations/from/${encodeURIComponent(value)}`;
  if (kind === "posts") return `/api/v1/profile/posts?profile_user_id=${encodeURIComponent(value)}&limit=12`;
  return `/api/v1/user/${encodeURIComponent(value)}/public_profile`;
}

const refused = (status: number | null) => status === 403 || status === 429;

/**
 * Substack's public JSON (unofficial, keyless, may change), always through a publication's own domain (GATEWAYS:
 * substack.com challenges datacenter IPs). Calls are spaced 0.5 s and rotate over the gateways; a 403 / 429 tries the
 * next gateways (up to 3), then pauses and retries twice; after 3 refused subjects in a row no more pauses this run:
 * each later refusal lands in bronze as a failed fetch (the Data page shows it) and the run goes on.
 */
export const substack: Source = {
  name: SUBSTACK_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(s, ctx) {
    const path = pathOf(s);
    let state = runState.get(ctx.fetch);
    if (!state) runState.set(ctx.fetch, (state = { inARow: 0, next: 0 }));
    const attempt = async (retried: boolean) => {
      let out;
      for (let i = 0; i < Math.min(3, GATEWAYS.length); i++) {
        const url = `https://${GATEWAYS[state.next++ % GATEWAYS.length]}${path}`;
        if (!process.env.VITEST) await sleep(500);
        out = await getJson(ctx, url, { url, ...(retried || i > 0 ? { retried: true } : {}) }, { headers: HEADERS });
        if (!refused(out.httpStatus)) break;
      }
      return out!;
    };
    const pauses = process.env.VITEST || state.inARow >= 3 ? [] : [5_000, 20_000];
    let out = await attempt(false);
    for (const pause of pauses) {
      if (!refused(out.httpStatus)) break;
      await sleep(pause);
      out = await attempt(true);
    }
    state.inARow = refused(out.httpStatus) ? state.inARow + 1 : 0;
    return out;
  },
};

async function draftedHandles(db: Db): Promise<Set<string>> {
  const rows = await db.select({ handle: growth.outreachMessages.handle }).from(growth.outreachMessages);
  return new Set(rows.map((r) => r.handle));
}

const SEED_IDS = new Set<string>(SEEDS.map((x) => x.id));
const seedHostOf = new Map<string, string>(SEEDS.map((x) => [x.id, x.host]));

/** Round 0: every seed's recommendations, Thierry's profile (the goal series), every drafted author's profile. */
async function networkSubjects(db: Db): Promise<string[]> {
  const handles = [...(await draftedHandles(db))].sort();
  return [...SEEDS.map((x) => subject("recs", x.id)), subject("profile", OWN.handle), ...handles.map((h) => subject("profile", h))];
}

/**
 * Crawl rounds: 1 = the recommendations of what the seeds recommend (2nd hop), 2 = public profile of the ranking
 * candidates, 3 = latest posts of every author profiled. Then done.
 */
async function expandNetwork(db: Db, soFar: BronzeFetch[], round: number): Promise<string[]> {
  const graph = graphOf(soFar);
  if (round === 1) {
    return [...graph.pubs.keys()].filter((id) => !SEED_IDS.has(id)).slice(0, MAX_RECOMMENDATION_FETCHES - SEED_IDS.size).map((id) => subject("recs", id));
  }
  const profiles = fetchesOf(soFar, "profile").map((f) => parseProfile(f.payload));
  if (round === 2) {
    const pubs = new Map(graph.pubs);
    for (const prof of profiles) for (const p of prof.publications) if (!pubs.has(p.id)) pubs.set(p.id, p);
    const ids = selectCandidates([...pubs.values()], (id) => graph.inbound.get(id)?.size ?? 0, { draftedHandles: await draftedHandles(db), ownId: OWN.publicationId });
    return ids.flatMap((id) => (pubs.get(id)!.authorHandle ? [subject("profile", pubs.get(id)!.authorHandle!)] : []));
  }
  if (round !== 3) return [];
  return profiles.filter((p) => p.userId && p.handle !== OWN.handle).map((p) => subject("posts", p.userId!));
}

export function makeSubstackNetwork(opts: { complete?: Complete; now?: () => Date } = {}): Dimension {
  return {
    name: NETWORK_DIMENSION,
    description: "Substack's recommendation graph 2 hops from our seeds, the targets' audience and activity, and Thierry's subscriber count.",
    sources: [substack],
    subjects: networkSubjects,
    expand: expandNetwork,
    promote: (db, fetches, ctx) => promoteNetwork(db, fetches, { ...opts, complete: opts.complete ?? ctx.complete }),
  };
}

export const substackNetwork = makeSubstackNetwork();

type PubState = typeof growth.substackPublications.$inferInsert & { sources: string[]; bronzeIds: string[]; reachedFrom: string[] };

/** bronze -> silver (publications, authors, recommendation edges, dated facts) -> fit judgments -> gold. */
export async function promoteNetwork(
  db: Db,
  rows: BronzeFetch[],
  opts: { complete?: Complete; now?: () => Date } = {},
): Promise<PromoteResult> {
  const now = opts.now?.() ?? new Date();
  const pubs = new Map<string, PubState>((await db.select().from(growth.substackPublications)).map((p) => [p.id, { ...p }]));
  const touched = new Set<string>();
  const ordered = [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());

  const observe = (o: Partial<PublicationObservation> & { id: string }, tag: string, bronzeId: string, reachedFrom: string[]) => {
    const prev = pubs.get(o.id);
    const next: PubState = prev
      ? { ...prev, sources: [...prev.sources], bronzeIds: [...prev.bronzeIds], reachedFrom: [...prev.reachedFrom] }
      : { id: o.id, name: o.name ?? o.host ?? o.id, host: o.host ?? "", sources: [], bronzeIds: [], reachedFrom: [] };
    for (const k of ["name", "host", "heroText", "authorHandle", "authorName", "paymentsState"] as const) {
      if (o[k]) (next as Record<string, unknown>)[k] = o[k];
    }
    const i = next.sources.indexOf(tag);
    if (i === -1) {
      next.sources.push(tag);
      next.bronzeIds.push(bronzeId);
    } else next.bronzeIds[i] = bronzeId;
    for (const r of reachedFrom) if (!next.reachedFrom.includes(r)) next.reachedFrom.push(r);
    next.lastSeenAt = now;
    pubs.set(o.id, next);
    touched.add(o.id);
  };
  const facts = new Map<string, Assertion[]>();
  const assert = (pubId: string, a: Assertion) => facts.set(`pub:${pubId}`, [...(facts.get(`pub:${pubId}`) ?? []), a]);

  // 1. Posts: latest post date (dated) and latest posts of each publication the author wrote in.
  for (const f of fetchesOf(ordered, "posts")) {
    for (const [publicationId, posts] of parsePosts(f.payload)) {
            assert(publicationId, { source: TAG.posts, field: `last-post-at@${isoDate(f.fetchedAt)}`, value: posts[0].date, bronzeId: f.id });
      assert(publicationId, { source: TAG.posts, field: "recent-posts", value: posts.slice(0, 6), bronzeId: f.id });
    }
  }

  // 2. Recommendations, seeds' lists first so "reached from" flows hop by hop; a list replaces its previous edges.
  const recFetches = fetchesOf(ordered, "recs").sort((a, b) => Number(SEED_IDS.has(parseSubject(b.subject).value)) - Number(SEED_IDS.has(parseSubject(a.subject).value)));
  let edgeRows = 0;
  for (const f of recFetches) {
    const from = parseSubject(f.subject).value;
    const recommended = parseRecommendations(f.payload);
    const seedHost = seedHostOf.get(from);
    const reach = [...new Set([...(seedHost ? [seedHost] : []), ...(pubs.get(from)?.reachedFrom ?? [])])];
    for (const p of recommended) observe(p, TAG.recs, f.id, reach);
    const keep = new Set(recommended.map((p) => p.id));
    const existing = await db.select().from(growth.substackRecommendations).where(eq(growth.substackRecommendations.fromId, from));
    const gone = existing.filter((e) => !keep.has(e.toId)).map((e) => e.toId);
    if (gone.length) await db.delete(growth.substackRecommendations).where(and(eq(growth.substackRecommendations.fromId, from), inArray(growth.substackRecommendations.toId, gone)));
    for (const chunk of chunks([...keep], 200)) {
      await db
        .insert(growth.substackRecommendations)
        .values(chunk.map((toId) => ({ fromId: from, toId, sources: [TAG.recs], bronzeIds: [f.id], lastSeenAt: now })))
        .onConflictDoUpdate({
          target: [growth.substackRecommendations.fromId, growth.substackRecommendations.toId],
          set: { bronzeIds: [f.id], lastSeenAt: now },
        });
    }
    edgeRows += keep.size;
  }

  // 3. Profiles: the author's publications, subscriber count as a dated fact on each publication they author.
  for (const f of fetchesOf(ordered, "profile")) {
    const prof = parseProfile(f.payload);
    for (const p of prof.publications) observe(p, TAG.profile, f.id, []);
    if (prof.subscribers === null) continue;
    for (const p of prof.publications) {
      assert(p.id, { source: TAG.profile, field: `subscribers@${isoDate(f.fetchedAt)}`, value: prof.subscribers, bronzeId: f.id });
    }
  }

  const changed = [...touched].map((id) => pubs.get(id)!);
  for (const chunk of chunks(changed, 200)) {
    await db
      .insert(growth.substackPublications)
      .values(chunk)
      .onConflictDoUpdate({
        target: growth.substackPublications.id,
        set: {
          name: sqlExcluded("name"),
          host: sqlExcluded("host"),
          heroText: sqlExcluded("hero_text"),
          authorHandle: sqlExcluded("author_handle"),
          authorName: sqlExcluded("author_name"),
          paymentsState: sqlExcluded("payments_state"),
          reachedFrom: sqlExcluded("reached_from"),
          sources: sqlExcluded("sources"),
          bronzeIds: sqlExcluded("bronze_ids"),
          lastSeenAt: sqlExcluded("last_seen_at"),
        },
      });
  }
  const factRows = await promoteFacts(db, NETWORK_DIMENSION, facts);

  const candidates = await rebuildCandidates(db);
  const errors = await judgeFit(db, candidates, opts.complete);
  await rebuildGoldGrowth(db, now);
  if (errors.length > 0) throw new Error(`${errors.length} fit judgments failed: ${errors.slice(0, 5).join(" | ")}`);
  return { silverRowsBySource: { [SUBSTACK_SOURCE]: changed.length + edgeRows + factRows } };
}

const sqlExcluded = (col: string) => sql.raw(`excluded.${col}`);

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Ranking candidates from silver: inbound counted over every stored edge (the crawled cluster). */
async function rebuildCandidates(db: Db) {
  const pubs = await db.select().from(growth.substackPublications);
  const edges = await db.select({ fromId: growth.substackRecommendations.fromId, toId: growth.substackRecommendations.toId }).from(growth.substackRecommendations);
  const inbound = new Map<string, Set<string>>();
  for (const e of edges) inbound.set(e.toId, (inbound.get(e.toId) ?? new Set()).add(e.fromId));
  const ids = selectCandidates(pubs, (id) => inbound.get(id)?.size ?? 0, { draftedHandles: await draftedHandles(db), ownId: OWN.publicationId });
  const byId = new Map(pubs.map((p) => [p.id, p]));
  return ids.map((id) => ({ pub: byId.get(id)!, inbound: inbound.get(id)?.size ?? 0 }));
}

type Candidate = Awaited<ReturnType<typeof rebuildCandidates>>[number];

/** What the fit judgment is asked: our reader (skill `audience`) in the question, the publication in the input. */
export function fitRequest(pub: { name: string; heroText: string | null }, recentTitles: string[]) {
  const question = [
    "Our reader: a self-directed, experienced small-cap investor (often ex-finance) who manages their own money, reads filings,",
    "hunts under-covered micro and small caps, special situations and deep value, often outside the US (Japan, Korea, Canada, Europe),",
    "and already pays for idea newsletters. Not our reader: beginners, options / crypto / day traders, macro-headline followers.",
    "Does this publication's reader match ours? yes = same reader, partly = overlapping, no = a different reader.",
  ].join(" ");
  const input = [`Publication: ${pub.name}.`, pub.heroText ? `About: ${pub.heroText}` : "About: none written.", ...recentTitles.map((t) => `Recent post: ${t}.`)].join("\n");
  return { question, input };
}

/** One stored judgment per candidate publication (judged once, never recomputed). Returns the failures. */
async function judgeFit(db: Db, candidates: Candidate[], complete?: Complete): Promise<string[]> {
  const ids = candidates.map((c) => c.pub.id);
  if (ids.length === 0) return [];
  const done = new Set(
    (
      await db
        .select({ id: judgments.subjectId })
        .from(judgments)
        .where(and(eq(judgments.subjectKind, FIT_SUBJECT_KIND), eq(judgments.questionKey, FIT_QUESTION_KEY), inArray(judgments.subjectId, ids)))
    ).map((r) => r.id),
  );
  const queue = candidates.filter((c) => !done.has(c.pub.id)).slice(0, MAX_JUDGMENTS_PER_RUN);
  if (queue.length === 0) return [];
  if (!complete) throw new Error("substack-network: no LLM in the collector context (ctx.complete is set in cli.ts)");
  const llm = complete;
  const facts = await readFacts(db, NETWORK_DIMENSION, queue.map((c) => `pub:${c.pub.id}`));
  const errors: string[] = [];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const posts = (facts.get(`pub:${c.pub.id}`)?.get("recent-posts")?.[0]?.value as { title: string }[] | undefined) ?? [];
        try {
          await judge(
            db,
            { subjectKind: FIT_SUBJECT_KIND, subjectId: c.pub.id, questionKey: FIT_QUESTION_KEY, ...fitRequest(c.pub, posts.map((p) => p.title)), choices: FIT_CHOICES },
            llm,
          );
        } catch (err) {
          errors.push(`${c.pub.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );
  return errors;
}

/** Latest value of a dated field family (`subscribers@<date>`): the newest date wins. */
function latestDated(fields: Map<string, { value: unknown }[]> | undefined, prefix: string): { date: string; value: unknown } | null {
  if (!fields) return null;
  let best: { date: string; value: unknown } | null = null;
  for (const [field, states] of fields) {
    if (!field.startsWith(`${prefix}@`) || !states[0]) continue;
    const date = field.slice(prefix.length + 1);
    if (!best || date > best.date) best = { date, value: states[0].value };
  }
  return best;
}

/** gold.growth_targets (ranked) + gold.growth_audience (Thierry's subscribers per day), rebuilt from silver. */
export async function rebuildGoldGrowth(db: Db, now: Date = new Date()): Promise<void> {
  const candidates = await rebuildCandidates(db);
  const facts = await readFacts(db, NETWORK_DIMENSION, candidates.map((c) => `pub:${c.pub.id}`));
  const fits = new Map(
    (
      await db.select().from(judgments).where(and(eq(judgments.subjectKind, FIT_SUBJECT_KIND), eq(judgments.questionKey, FIT_QUESTION_KEY)))
    ).map((j) => [j.subjectId, j]),
  );

  const rows = candidates.map(({ pub, inbound }) => {
    const f = facts.get(`pub:${pub.id}`);
    const subs = latestDated(f, "subscribers");
    const last = latestDated(f, "last-post-at");
    const lastPostAt = last ? new Date(String(last.value)) : null;
    const inactive = !!lastPostAt && now.getTime() - lastPostAt.getTime() > INACTIVE_AFTER_DAYS * 86_400_000;
    const fit = fits.get(pub.id) ?? null;
    const excludedReason = (pub.authorHandle && EXCLUDED_AUTHORS[pub.authorHandle]) || null;
    const subscribers = typeof subs?.value === "number" ? subs.value : null;
    const score =
      excludedReason ? 0 : (fit ? (FIT_WEIGHT[fit.verdict] ?? UNJUDGED_WEIGHT) : UNJUDGED_WEIGHT) * Math.max(inbound, 1) * Math.log10(Math.max(subscribers ?? 10, 10)) * (inactive ? 0.2 : 1);
    return {
      publicationId: pub.id,
      name: pub.name,
      url: `https://${pub.host}`,
      heroText: pub.heroText,
      authorHandle: pub.authorHandle,
      authorName: pub.authorName,
      subscribers,
      subscribersAt: subs?.date ?? null,
      inbound,
      lastPostAt,
      inactive,
      fit: fit?.verdict ?? null,
      fitProbability: fit?.probability ?? null,
      fitSentence: fit?.citedSentence ?? null,
      excludedReason,
      score,
      rank: 0,
      recentPosts: (f?.get("recent-posts")?.[0]?.value as growth.GoldGrowthTarget["recentPosts"] | undefined) ?? [],
      sources: pub.sources,
      rebuiltAt: now,
    };
  });
  rows.sort((a, b) => b.score - a.score || a.publicationId.localeCompare(b.publicationId)).forEach((r, i) => (r.rank = i + 1));

  await db.delete(growth.goldGrowthTargets);
  for (const chunk of chunks(rows, 200)) await db.insert(growth.goldGrowthTargets).values(chunk);

  await rebuildGoldAudience(db);
}
