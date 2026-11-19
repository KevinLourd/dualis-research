import { and, eq, sql } from "drizzle-orm";
import { promoteFacts, readFacts } from "@/bsg/facts";
import { type Assertion, type FactState, pickWinner } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import { type PositionCite, type PositionProvenance, portfolioPositions } from "@/db/schema/portfolio";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { readPrivateFile } from "@/private/files";
import type { Dimension, PromoteResult, Source } from "../../types";

/**
 * Thierry's positions: direction, entry day and price, weight, open or closed. Two authors only:
 * `substack` = what his published posts state (data/portfolio/positions.json, every value with the post sentence),
 * `console` = what he types on the Portfolio page. His console word wins. Nothing is ever guessed: a field no one
 * stated stays empty.
 */

export const PORTFOLIO_DIMENSION = "portfolio";
export const SUBSTACK_SOURCE = "substack";
/** Only what his posts state (Kevin 2026-11-19: no position typed by hand). */
const PRIORITY = [SUBSTACK_SOURCE] as const;
const MANUAL = [] as const;
const FILE = "data/portfolio/positions.json";

/** Fields Thierry can state per position. `reportedReturn` = `{ ratio, asOf }`. */
export const POSITION_FIELDS = ["direction", "entryDate", "entryPrice", "weight", "status", "reportedReturn"] as const;
export type PositionField = (typeof POSITION_FIELDS)[number];
const CITE = (field: string) => `${field}#cite`;

type FileEntry = { value: unknown } & PositionCite;
type PositionsFile = { positions: Record<string, Partial<Record<PositionField, FileEntry>>> };

export const substackPosts: Source = {
  name: SUBSTACK_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol, ctx) {
    const file = JSON.parse(await readPrivateFile(ctx.db, FILE)) as PositionsFile;
    return { request: { file: FILE, symbol }, httpStatus: null, payload: file.positions[symbol] ?? {} };
  },
};

/** The portfolio tickers of the watchlist. */
export async function portfolioSymbols(db: Db): Promise<string[]> {
  const rows = await db
    .select({ symbol: silver.tickers.symbol })
    .from(silver.tickers)
    .where(and(sql`${silver.tickers.active}`, eq(silver.tickers.inPortfolio, true)))
    .orderBy(silver.tickers.symbol);
  return rows.map((r) => r.symbol);
}

export const portfolio: Dimension = {
  name: PORTFOLIO_DIMENSION,
  description: "Thierry's positions: direction, entry day and price, weight, open or closed (his posts + his console edits).",
  sources: [substackPosts],
  subjects: portfolioSymbols,
  promote: promotePortfolio,
};

/** Assertions read from one bronze row (a post file entry, or a console edit). */
export function assertionsOf(f: BronzeFetch): Assertion[] {
  const entry = (f.payload ?? {}) as Partial<Record<PositionField, FileEntry>>;
  return Object.entries(entry).flatMap(([field, e]) => {
    if (!e) return [];
    const { value, ...cite } = e;
    return [
      { source: SUBSTACK_SOURCE, field, value, bronzeId: f.id },
      { source: SUBSTACK_SOURCE, field: CITE(field), value: cite, bronzeId: f.id },
    ];
  });
}

export async function promotePortfolio(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  const ok = rows.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const bySubject = new Map<string, Assertion[]>();
  for (const f of ok) bySubject.set(f.subject, [...(bySubject.get(f.subject) ?? []), ...assertionsOf(f)]);
  const silverRows = await promoteFacts(db, PORTFOLIO_DIMENSION, bySubject);
  await rebuildGoldPortfolio(db);
  const bySource: Record<string, number> = {};
  for (const f of ok) bySource[f.source] = silverRows;
  return { silverRowsBySource: bySource };
}

/** gold.portfolio_positions for every portfolio ticker, Thierry's console word winning per field. */
export async function rebuildGoldPortfolio(db: Db): Promise<number> {
  const symbols = await portfolioSymbols(db);
  const facts = await readFacts(db, PORTFOLIO_DIMENSION, symbols);
  const now = new Date();
  const out = symbols.map((symbol) => {
    const byField = facts.get(symbol) ?? new Map<string, FactState[]>();
    const provenance: PositionProvenance = {};
    const value = (field: PositionField) => {
      const winner = pickWinner(byField.get(field) ?? [], { priority: PRIORITY, manual: MANUAL });
      if (!winner) return null;
      const cite = winner.sources.includes(SUBSTACK_SOURCE) ? ((byField.get(CITE(field))?.[0]?.value as PositionCite) ?? null) : null;
      provenance[field] = { sources: winner.sources, cite };
      return winner.value;
    };
    const reported = value("reportedReturn") as { ratio: number; asOf: string } | null;
    return {
      symbol,
      direction: value("direction") as "long" | "short" | null,
      entryDate: value("entryDate") as string | null,
      entryPrice: value("entryPrice") as number | null,
      weight: value("weight") as number | null,
      status: value("status") as "open" | "closed" | null,
      reportedReturn: reported?.ratio ?? null,
      reportedReturnAsOf: reported?.asOf ?? null,
      provenance,
      rebuiltAt: now,
    };
  });
  await db.transaction(async (tx) => {
    await tx.delete(portfolioPositions);
    if (out.length) await tx.insert(portfolioPositions).values(out);
  });
  return out.length;
}

