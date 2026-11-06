import { catalysts } from "./dimensions/catalysts";
import { companyProfile } from "./dimensions/company-profile";
import { consensusDim } from "./dimensions/consensus";
import { thesisConfidenceDim } from "./dimensions/thesis-confidence";
import { contentAccounts } from "./dimensions/content-accounts";
import { contentDispatch } from "./dimensions/content-dispatch";
import { contentDrafts } from "./dimensions/content-drafts";
import { contentPosts } from "./dimensions/content-posts";
import { coverPhotos } from "./dimensions/cover-photos";
import { contentReplies } from "./dimensions/content-replies";
import { contentVoices } from "./dimensions/content-voices";
import { news } from "./dimensions/news";
import { onedrive } from "./dimensions/onedrive";
import { onedriveFilings } from "./dimensions/onedrive-filings";
import { earnings } from "./dimensions/earnings";
import { financials } from "./dimensions/financials";
import { analysis } from "./dimensions/analysis";
import { peersDim } from "./dimensions/peers";
import { valuationDim } from "./dimensions/valuation";
import { evidenceDim } from "./dimensions/evidence";
import { narrativeStateDim } from "./dimensions/narrative-state";
import { signalsDim } from "./dimensions/signals";
import { growthOutreach } from "./dimensions/growth-outreach";
import { substackNetwork } from "./dimensions/substack-network";
import { filingsDimension } from "./dimensions/filings";
import { portfolio } from "./dimensions/portfolio";
import { price } from "./dimensions/price";
import { thesis } from "./dimensions/thesis";
import { watchlist } from "./dimensions/watchlist";
import type { Dimension } from "./types";

/**
 * Every dimension, in run order (`collect all` runs them top to bottom).
 * A new dimension = a folder under dimensions/ + one line here. Watchlist first: it defines the subjects. News after company-profile: it queries the resolved names.
 * Outreach before substack-network: the drafted authors join the crawl's candidates.
 * Catalysts after news and filings: it judges each new item against the ticker's narrative.
 * OneDrive (Thierry's research folder) before thesis: the research reads it. Its write-back right after filings.
 * Consensus after earnings: analyst expectations vs actuals, read by the signal that says "above / below what the market expects".
 * Financials after price and filings: EV reads the quote, EDINET the fiscal year end, the PDF extraction the annual report link.
 * Portfolio right after watchlist: Thierry's positions (his posts + console edits); price also fetches the S&P 500 (`^GSPC`) the Portfolio page compares against.
 * Peers (comparables + analyst targets) after consensus; Valuation (the fair value pyramid) after peers; Analysis after valuation (it reads the Fair Value); Evidence after catalysts (every item against each driver); Narrative State after it (each driver's tag, then the ticker's); Signals last (fair value x the ticker's tag).
 * Cover photos right after content-posts: one photo per own article for the website covers.
 * Thesis confidence right after catalysts: it weighs every judged item so far (narrative holds or cracks).
 */
export const DIMENSIONS: readonly Dimension[] = [watchlist, portfolio, companyProfile, news, onedrive, thesis, price, filingsDimension, onedriveFilings, earnings, financials, consensusDim, peersDim, valuationDim, analysis, catalysts, thesisConfidenceDim, evidenceDim, narrativeStateDim, signalsDim, contentAccounts, contentPosts, coverPhotos, contentVoices, contentDrafts, contentDispatch, contentReplies, growthOutreach, substackNetwork];

/**
 * Growth and content dimensions (Substack crawl, outreach, posts, voices, drafts): the daily schedule only. A deploy's
 * collect runs `core` = everything else, the analysis chain, so it lands in minutes (Kevin 2026-11-05: speed).
 */
export const GROWTH_DIMENSIONS: readonly string[] = ["content-accounts", "content-posts", "cover-photos", "content-voices", "content-drafts", "content-dispatch", "content-replies", "growth-outreach", "substack-network"];

/** `all`, `core` (all but Growth/content), `growth`, or one dimension name. */
export function dimensionsFor(arg: string): readonly Dimension[] {
  if (arg === "all") return DIMENSIONS;
  if (arg === "core") return DIMENSIONS.filter((d) => !GROWTH_DIMENSIONS.includes(d.name));
  if (arg === "growth") return DIMENSIONS.filter((d) => GROWTH_DIMENSIONS.includes(d.name));
  return [dimensionByName(arg)];
}

export function dimensionByName(name: string): Dimension {
  const d = DIMENSIONS.find((x) => x.name === name);
  if (!d) throw new Error(`unknown dimension "${name}"; known: ${DIMENSIONS.map((x) => x.name).join(", ")}`);
  return d;
}
