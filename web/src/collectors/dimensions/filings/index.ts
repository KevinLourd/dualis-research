import { and, inArray, sql } from "drizzle-orm";
import { mergeSightings, type Sourced } from "@/bsg/entities";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { filings } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { analysedSymbols } from "../watchlist";
import { FILING_SOURCES, type FilingItem } from "./sources";

export const FILINGS_DIMENSION = "filings";

export const filingsDimension: Dimension = {
  name: FILINGS_DIMENSION,
  description: "Regulatory filings and exchange announcements, from each market's own registry.",
  sources: FILING_SOURCES,
  subjects: analysedSymbols,
  promote: promoteFilings,
};

type Item = FilingItem & { symbol: string };
const keyOf = (f: { registry: string; filingKey: string }) => `${f.registry}\u0000${f.filingKey}`;

/** bronze -> silver.filings (one row per registry filing, every source tag) -> gold.filings for those tickers. */
export async function promoteFilings(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  const sightings: { key: string; source: string; bronzeId: string; row: Item }[] = [];
  const silverRowsBySource: Record<string, number> = {};
  for (const f of ok) {
    const source = FILING_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`filings: no extractor for source "${f.source}"`);
    const items = source.extract(f.payload, f.subject);
    silverRowsBySource[f.source] = (silverRowsBySource[f.source] ?? 0) + items.length;
    for (const item of items) sightings.push({ key: keyOf(item), source: f.source, bronzeId: f.id, row: { ...item, symbol: f.subject } });
  }
  const symbols = [...new Set(ok.map((f) => f.subject))];
  if (sightings.length > 0) {
    const registries = [...new Set(sightings.map((s) => s.row.registry))];
    const keys = [...new Set(sightings.map((s) => s.row.filingKey))];
    const existingRows = await db
      .select()
      .from(filings)
      .where(and(inArray(filings.registry, registries), inArray(filings.filingKey, keys)));
    const existing = new Map(existingRows.map((r) => [keyOf(r), r as unknown as Sourced<Item>]));
    const merged = mergeSightings(existing, sightings, FILING_SOURCES.map((s) => s.name));
    const now = new Date();
    const rows = [...merged.values()].map((r) => ({
      symbol: r.symbol,
      registry: r.registry,
      filingKey: r.filingKey,
      form: r.form,
      title: r.title,
      filedAt: r.filedAt,
      url: r.url,
      language: r.language,
      sources: r.sources,
      bronzeIds: r.bronzeIds,
      lastSeenAt: now,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(filings)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [filings.registry, filings.filingKey],
          set: {
            form: sql`excluded.form`,
            title: sql`excluded.title`,
            filedAt: sql`excluded.filed_at`,
            url: sql`excluded.url`,
            sources: sql`excluded.sources`,
            bronzeIds: sql`excluded.bronze_ids`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        });
    }
  }
  await rebuildGoldFilings(db, symbols);
  return { silverRowsBySource };
}

export async function rebuildGoldFilings(db: Db, symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  await db.delete(gold.filings).where(inArray(gold.filings.symbol, symbols));
  await db.execute(sql`
    INSERT INTO gold.filings (id, symbol, registry, filing_key, form, title, filed_at, url, language, sources)
    SELECT id, symbol, registry, filing_key, form, title, filed_at, url, language, sources
    FROM silver.filings WHERE ${inArray(filings.symbol, symbols)}`);
}
