import { promoteFacts } from "@/bsg/facts";
import type { Assertion } from "@/bsg/provenance";
import type { BronzeFetch } from "@/db/schema/bronze";
import type { Db } from "@/db/types";
import type { Dimension, PromoteResult } from "../../types";
import { activeSymbols } from "../watchlist";
import { PROFILE_DIMENSION, rebuildGoldProfiles } from "./gold";
import { PROFILE_SOURCES } from "./sources";

/**
 * Worked example of a dimension, end to end:
 * fetch (FMP, Finnhub, Nasdaq, TMX, ASX, DART, Companies House, Wikidata, Wikipedia, FMP logos, Yahoo) -> bronze.fetches -> silver.facts (multi-source provenance) -> gold.company_profiles.
 */
export const companyProfile: Dimension = {
  name: PROFILE_DIMENSION,
  description: "Who the company is: name, logo, sector, industry, country, market cap, employees, website, description.",
  sources: PROFILE_SOURCES,
  subjects: activeSymbols,
  promote: promoteCompanyProfiles,
};

export async function promoteCompanyProfiles(db: Db, fetches: BronzeFetch[]): Promise<PromoteResult> {
  const bySubject = new Map<string, Assertion[]>();
  const subjectsBySource: Record<string, Set<string>> = {};
  // Oldest first, so a later fetch of the same source replaces an earlier one.
  const ok = fetches.filter((f) => !f.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
  for (const f of ok) {
    const source = PROFILE_SOURCES.find((s) => s.name === f.source);
    if (!source) throw new Error(`company-profile: no extractor for source "${f.source}"`);
    const list = bySubject.get(f.subject) ?? [];
    for (const [field, value] of Object.entries(source.extract(f.payload, f.subject))) {
      list.push({ source: f.source, field, value, bronzeId: f.id });
    }
    bySubject.set(f.subject, list);
    (subjectsBySource[f.source] ??= new Set()).add(f.subject);
  }
  await promoteFacts(db, PROFILE_DIMENSION, bySubject);
  await rebuildGoldProfiles(db);

  const silverRowsBySource: Record<string, number> = {};
  for (const [source, subjects] of Object.entries(subjectsBySource)) silverRowsBySource[source] = subjects.size;
  return { silverRowsBySource };
}
