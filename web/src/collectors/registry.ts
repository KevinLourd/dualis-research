import { catalysts } from "./dimensions/catalysts";
import { companyProfile } from "./dimensions/company-profile";
import { consensusDim } from "./dimensions/consensus";
import { thesisConfidenceDim } from "./dimensions/thesis-confidence";
import { contentAccounts } from "./dimensions/content-accounts";
import { contentDispatch } from "./dimensions/content-dispatch";
import { contentDrafts } from "./dimensions/content-drafts";
import { contentIdeas } from "./dimensions/content-ideas";
import { contentVisuals } from "./dimensions/content-visuals";
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
import { growthBriefDim } from "./dimensions/growth-brief";
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
 * Content ideas after content-voices (the day's Ideas, scored per channel x format); content-drafts after it writes the drafts Thierry asked for; content-visuals after it draws each drafted Idea's chart, card, video and news capture.
 * Growth brief last: it reads the subscriber count and outreach the two before it just rebuilt.
 * Thesis confidence right after catalysts: it weighs every judged item so far (narrative holds or cracks).
 */
export const DIMENSIONS: readonly Dimension[] = [watchlist, portfolio, companyProfile, news, onedrive, thesis, price, filingsDimension, onedriveFilings, earnings, financials, consensusDim, peersDim, valuationDim, analysis, catalysts, thesisConfidenceDim, evidenceDim, narrativeStateDim, signalsDim, contentAccounts, contentPosts, coverPhotos, contentVoices, contentIdeas, contentDrafts, contentVisuals, contentDispatch, contentReplies, growthOutreach, substackNetwork, growthBriefDim];

/**
 * Growth and content dimensions (Substack crawl, outreach, posts, voices, drafts): the daily schedule only. A deploy's
 * collect runs `core` = everything else, the analysis chain, so it lands in minutes (Kevin 2026-11-05: speed).
 */
export const GROWTH_DIMENSIONS: readonly string[] = ["content-accounts", "content-posts", "cover-photos", "content-voices", "content-ideas", "content-drafts", "content-visuals", "content-dispatch", "content-replies", "growth-outreach", "substack-network", "growth-brief"];

/**
 * Stages of a collect (Kevin 2026-11-06: « comment speeder x10 »): the dimensions of one stage run at the same time,
 * stages one after the other. A stage only reads what earlier stages wrote; Yahoo users (company-profile, price,
 * consensus, financials, peers) sit in different stages so they never hit its rate limit together.
 */
export const STAGES: readonly (readonly string[])[] = [
  ["watchlist"],
  ["portfolio", "company-profile"],
  ["news", "onedrive", "price", "filings", "earnings"],
  ["thesis", "onedrive-filings", "consensus"],
  ["financials"],
  ["peers"],
  ["valuation"],
  ["analysis", "catalysts"],
  ["thesis-confidence", "evidence"],
  ["narrative-state"],
  ["signals"],
  ...GROWTH_DIMENSIONS.map((d) => [d]),
];

/** The dimensions to run, grouped by stage, in order. */
export function stagesFor(dimensions: readonly Dimension[]): Dimension[][] {
  const names = new Set(dimensions.map((d) => d.name));
  return STAGES.map((stage) => stage.filter((n) => names.has(n)).map(dimensionByName)).filter((s) => s.length > 0);
}

/**
 * `all`, `core` (all but Growth/content), `growth`, one dimension name, `from:<name>` (that dimension and every later
 * core one: what a change to it can move), or a comma list of those.
 */
export function dimensionsFor(arg: string): readonly Dimension[] {
  if (arg === "all") return DIMENSIONS;
  if (arg === "core") return DIMENSIONS.filter((d) => !GROWTH_DIMENSIONS.includes(d.name));
  if (arg === "growth") return DIMENSIONS.filter((d) => GROWTH_DIMENSIONS.includes(d.name));
  if (arg.includes(",")) {
    const names = new Set(arg.split(",").flatMap((a) => dimensionsFor(a.trim()).map((d) => d.name)));
    return DIMENSIONS.filter((d) => names.has(d.name));
  }
  if (arg.startsWith("from:")) {
    const i = DIMENSIONS.indexOf(dimensionByName(arg.slice(5)));
    return DIMENSIONS.slice(i).filter((d) => d === DIMENSIONS[i] || !GROWTH_DIMENSIONS.includes(d.name));
  }
  return [dimensionByName(arg)];
}

/**
 * What a merge must collect (the deploy's "Refresh data now"), from the files it changed: a dimension's folder ->
 * `from:<the earliest one>`; shared collector, schema, LLM or migration code -> `core`; console / site / docs only -> nothing.
 */
export function collectPlan(files: readonly string[]): string | null {
  let core = false;
  const touched = new Set<string>();
  for (const f of files) {
    const dim = /^web\/src\/collectors\/dimensions\/([^/]+)\//.exec(f)?.[1];
    if (dim && DIMENSIONS.some((d) => d.name === dim)) touched.add(dim);
    else if (/^web\/(src\/(collectors|llm|bsg|db|private|growth|content|onedrive)\/|drizzle\/)/.test(f) && !/\.test\.ts$/.test(f)) core = true;
  }
  if (core) return "core";
  const order = DIMENSIONS.map((d) => d.name).filter((n) => touched.has(n));
  if (order.length === 0) return null;
  const growth = order.filter((n) => GROWTH_DIMENSIONS.includes(n));
  const firstCore = order.find((n) => !GROWTH_DIMENSIONS.includes(n));
  return [...(firstCore ? [`from:${firstCore}`] : []), ...growth].join(",");
}

export function dimensionByName(name: string): Dimension {
  const d = DIMENSIONS.find((x) => x.name === name);
  if (!d) throw new Error(`unknown dimension "${name}"; known: ${DIMENSIONS.map((x) => x.name).join(", ")}`);
  return d;
}
