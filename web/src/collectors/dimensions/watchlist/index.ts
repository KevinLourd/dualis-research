import { inArray, notInArray, sql } from "drizzle-orm";
import { promoteFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult, Source } from "../../types";
import { PROFILE_DIMENSION, rebuildGoldProfiles } from "../company-profile/gold";
import { readPrivateFile } from "@/private/files";
import { parseWatchlist } from "./parse";

export const WATCHLIST_SOURCE = "watchlist";
const FILE = "data/watchlist.json";

/** Thierry's watchlist file (app.private_files) (the console editor becomes a second source later). */
export const watchlistFile: Source = {
  name: WATCHLIST_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject, ctx) {
    const text = await readPrivateFile(ctx.db, subject);
    return { request: { file: subject }, httpStatus: null, payload: JSON.parse(text) };
  },
};

export const watchlist: Dimension = {
  name: "watchlist",
  description: "Tickers Thierry follows, his portfolio flags, aliases, names and thesis notes.",
  sources: [watchlistFile],
  subjects: async () => [FILE],
  promote: promoteWatchlist,
};

/** Latest successful watchlist file -> silver.tickers / silver.theses / name facts -> gold.tickers + profiles. */
export async function promoteWatchlist(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const latest = fetches
    .filter((f) => f.source === WATCHLIST_SOURCE && !f.error)
    .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
  if (!latest) return { silverRowsBySource: {} };

  const rows = parseWatchlist(latest.payload);
  const symbols = rows.map((r) => r.symbol);
  const now = new Date();

  await db
    .insert(silver.tickers)
    .values(
      rows.map((r) => ({
        symbol: r.symbol,
        market: r.market,
        aliases: r.aliases,
        inPortfolio: r.inPortfolio,
        analysed: r.analysed,
        active: true,
        sources: [WATCHLIST_SOURCE],
        bronzeIds: [latest.id],
        lastRebuiltAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: silver.tickers.symbol,
      set: {
        market: sql`excluded.market`,
        aliases: sql`excluded.aliases`,
        inPortfolio: sql`excluded.in_portfolio`,
        analysed: sql`excluded.analysed`,
        active: true,
        sources: sql`excluded.sources`,
        bronzeIds: sql`excluded.bronze_ids`,
        lastRebuiltAt: now,
      },
    });
  await db
    .update(silver.tickers)
    .set({ active: false, lastRebuiltAt: now })
    .where(notInArray(silver.tickers.symbol, symbols));

  const notes = rows.filter((r) => r.thesisNote);
  if (notes.length > 0) {
    await db
      .insert(silver.theses)
      .values(
        notes.map((r) => ({
          tickerSymbol: r.symbol,
          summary: r.thesisNote!,
          author: "thierry" as const,
          status: "approved" as const,
          sources: [WATCHLIST_SOURCE],
          bronzeIds: [latest.id],
          lastRebuiltAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [silver.theses.tickerSymbol, silver.theses.author],
        set: { summary: sql`excluded.summary`, bronzeIds: sql`excluded.bronze_ids`, lastRebuiltAt: now },
      });
  }

  // A name Thierry typed is a company-profile fact like any other source's, and wins as the manual source.
  const nameFacts = new Map<string, Assertion[]>();
  for (const r of rows) {
    if (r.name) nameFacts.set(r.symbol, [{ source: WATCHLIST_SOURCE, field: "name", value: r.name, bronzeId: latest.id }]);
  }
  await promoteFacts(db, PROFILE_DIMENSION, nameFacts);

  await rebuildGoldTickers(db);
  await rebuildGoldProfiles(db);
  return { silverRowsBySource: { [WATCHLIST_SOURCE]: rows.length + notes.length + nameFacts.size } };
}

/** gold.tickers = active silver tickers + Thierry's approved thesis note. */
export async function rebuildGoldTickers(db: Db) {
  const active = await db.select().from(silver.tickers).where(sql`${silver.tickers.active}`);
  const symbols = active.map((t) => t.symbol);
  const notes =
    symbols.length === 0
      ? []
      : await db
          .select({ symbol: silver.theses.tickerSymbol, summary: silver.theses.summary, author: silver.theses.author })
          .from(silver.theses)
          .where(inArray(silver.theses.tickerSymbol, symbols));
  const noteOf = new Map(notes.filter((n) => n.author === "thierry").map((n) => [n.symbol, n.summary]));

  await db.transaction(async (tx) => {
    await tx.delete(gold.tickers);
    if (active.length === 0) return;
    await tx.insert(gold.tickers).values(
      active.map((t) => ({
        symbol: t.symbol,
        market: t.market,
        aliases: t.aliases,
        inPortfolio: t.inPortfolio,
        analysed: t.analysed,
        position: t.position,
        thesisNote: noteOf.get(t.symbol) ?? null,
      })),
    );
  });
}

/** Active watchlist symbols: the subjects of every per-ticker dimension. */
export async function activeSymbols(db: Db): Promise<string[]> {
  const rows = await db
    .select({ symbol: silver.tickers.symbol })
    .from(silver.tickers)
    .where(sql`${silver.tickers.active}`)
    .orderBy(silver.tickers.symbol);
  return rows.map((r) => r.symbol);
}

/**
 * Active tickers in the analysis scope (`analysis_scope` in data/watchlist.json): the subjects of every heavy dimension
 * (news, filings, statements, consensus, judges, LLM drafts). Cheap ones the Portfolio page needs (profile, price) keep `activeSymbols`.
 */
export async function analysedSymbols(db: Db): Promise<string[]> {
  const rows = await db
    .select({ symbol: silver.tickers.symbol })
    .from(silver.tickers)
    .where(sql`${silver.tickers.active} and ${silver.tickers.analysed}`)
    .orderBy(silver.tickers.symbol);
  return rows.map((r) => r.symbol);
}
