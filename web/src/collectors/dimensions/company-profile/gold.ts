import { notInArray, sql } from "drizzle-orm";
import { readFacts } from "@/bsg/facts";
import { pickWinner } from "@/bsg/provenance";
import { companyProfiles, type FieldProvenance } from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";

export const PROFILE_DIMENSION = "company-profile";

/**
 * Thierry's watchlist names win (manual); then the value most sources agree on; then this order of trust:
 * the exchange's or registry's own data first, data vendors next, encyclopedias last.
 */
export const PROFILE_PRIORITY = [
  "watchlist",
  "tmx",
  "asx",
  "companies-house",
  "dart",
  "nasdaq",
  "fmp",
  "finnhub",
  "wikidata",
  "wikipedia",
  "fmp-logo",
  "yahoo",
] as const;
export const PROFILE_MANUAL = ["watchlist"] as const;

const TEXT_FIELDS = [
  "name",
  "exchange",
  "currency",
  "country",
  "sector",
  "industry",
  "description",
  "website",
  "logoUrl",
  "ipoDate",
] as const;
const NUMBER_FIELDS = ["marketCap", "employees"] as const;
export const PROFILE_FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Rebuilds gold.company_profiles for every active ticker from silver.facts; drops inactive ones. */
export async function rebuildGoldProfiles(db: Db): Promise<number> {
  const active = await db
    .select({ symbol: silver.tickers.symbol })
    .from(silver.tickers)
    .where(sql`${silver.tickers.active}`);
  const symbols = active.map((t) => t.symbol);
  const facts = await readFacts(db, PROFILE_DIMENSION, symbols);

  const rows = symbols.map((symbol) => {
    const byField = facts.get(symbol) ?? new Map();
    const provenance: FieldProvenance = {};
    const values: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      const candidates = byField.get(field) ?? [];
      const winner = pickWinner(candidates, { priority: PROFILE_PRIORITY, manual: PROFILE_MANUAL });
      values[field] = winner?.value ?? null;
      if (winner) provenance[field] = { sources: winner.sources, alternatives: candidates.length - 1 };
    }
    return {
      symbol,
      name: values.name as string | null,
      exchange: values.exchange as string | null,
      currency: values.currency as string | null,
      country: values.country as string | null,
      sector: values.sector as string | null,
      industry: values.industry as string | null,
      description: values.description as string | null,
      website: values.website as string | null,
      logoUrl: values.logoUrl as string | null,
      ipoDate: values.ipoDate as string | null,
      marketCap: values.marketCap as number | null,
      employees: values.employees === null ? null : Math.round(values.employees as number),
      provenance,
      rebuiltAt: new Date(),
    };
  });

  if (symbols.length > 0) {
    await db.delete(companyProfiles).where(notInArray(companyProfiles.symbol, symbols));
  } else {
    await db.delete(companyProfiles);
  }
  for (const row of rows) {
    await db
      .insert(companyProfiles)
      .values(row)
      .onConflictDoUpdate({ target: companyProfiles.symbol, set: { ...row } });
  }
  return rows.length;
}
