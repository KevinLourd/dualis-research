import type { BronzeFetch } from "@/db/schema/bronze";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";

/** What one fetch returned, before it lands in bronze. Never put a secret in `request`. */
export type FetchOutcome = {
  request: Record<string, unknown>;
  httpStatus: number | null;
  payload?: unknown;
  payloadText?: string;
  /** Set when the fetch failed; the row still lands in bronze. */
  error?: string;
};

export type SourceContext = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  /** Set by the runner: lets a source read what it needs to build its request (names, aliases). Never written to. */
  db?: Db;
  /** LLM completion (Kevin's subscription in the CLI, a fake in tests). Only LLM dimensions read it. */
  complete?: Complete;
};

/** One external source of a dimension (FMP, Finnhub, a file...). */
export type Source = {
  name: string;
  /** Env vars the source needs; a missing one fails the source loudly, by name. */
  requiredEnv: readonly string[];
  /** False for subjects the source cannot answer (free tier limits); counted as skipped, not fetched. */
  covers: (subject: string) => boolean;
  fetch: (subject: string, ctx: SourceContext) => Promise<FetchOutcome>;
  /** Subjects fetched at once (default 1): an LLM judge source runs a few calls in parallel. */
  concurrency?: number;
};

export type PromoteResult = {
  /** Silver rows now held for what this run touched, per source name. */
  silverRowsBySource: Record<string, number>;
};

/**
 * A dimension = one kind of data (watchlist, company profile, news...).
 * The runner fetches every (source x subject) into bronze, then hands this run's bronze rows to `promote`,
 * which writes silver then rebuilds the gold tables the console reads.
 */
export type Dimension = {
  name: string;
  description: string;
  sources: readonly Source[];
  /** What to fetch: usually the active watchlist symbols. */
  subjects: (db: Db, ctx: SourceContext) => Promise<string[]>;
  /**
   * Crawl dimensions only: after each fetch round, the next subjects to fetch, read from this run's bronze so far
   * (e.g. the publications the seeds recommend). Empty = done. Subjects already fetched in this run are dropped.
   */
  expand?: (db: Db, fetchesSoFar: BronzeFetch[], round: number) => Promise<string[]>;
  /** `ctx` carries the LLM (`ctx.complete`) for dimensions whose promotion judges; Node only, set in cli.ts. */
  promote: (db: Db, fetches: BronzeFetch[], ctx: SourceContext) => Promise<PromoteResult>;
};
