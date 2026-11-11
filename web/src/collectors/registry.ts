import { companyProfile } from "./dimensions/company-profile";
import { consensusDim } from "./dimensions/consensus";
import { contentAccounts } from "./dimensions/content-accounts";
import { contentDispatch } from "./dimensions/content-dispatch";
import { contentDrafts } from "./dimensions/content-drafts";
import { contentIdeas } from "./dimensions/content-ideas";
import { contentPicks } from "./dimensions/content-picks";
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
import { fxDim } from "./dimensions/fx";
import { evidenceDim } from "./dimensions/evidence";
import { marketReactionDim } from "./dimensions/market-reaction";
import { narrativeStateDim } from "./dimensions/narrative-state";
import { narrativeSinceDim } from "./dimensions/narrative-since";
import { signalsDim } from "./dimensions/signals";
import { signalAlertsDim } from "./dimensions/signal-alerts";
import { growthBriefDim } from "./dimensions/growth-brief";
import { growthOutreach } from "./dimensions/growth-outreach";
import { macroNews } from "./dimensions/macro-news";
import { sandboxAccounts } from "./dimensions/sandbox-accounts";
import { substackTrending } from "./dimensions/substack-trending";
import { sandboxPosts } from "./dimensions/sandbox-posts";
import { substackNetwork } from "./dimensions/substack-network";
import { filingsDimension } from "./dimensions/filings";
import { portfolio } from "./dimensions/portfolio";
import { price } from "./dimensions/price";
import { intradayPrice } from "./dimensions/intraday-price";
import { thesis } from "./dimensions/thesis";
import { watchlist } from "./dimensions/watchlist";
import type { Dimension } from "./types";

/**
 * Every dimension, in run order (`collect all` runs them top to bottom).
 * A new dimension = a folder under dimensions/ + one line here. Watchlist first: it defines the subjects. News after company-profile: it queries the resolved names.
 * Outreach before substack-network: the drafted authors join the crawl's candidates.
 * OneDrive (Thierry's research folder) before thesis: the research reads it. Its write-back right after filings.
 * Consensus after earnings: analyst expectations vs actuals, read by the signal that says "above / below what the market expects".
 * Financials after price and filings: EV reads the quote, EDINET the fiscal year end, the PDF extraction the annual report link.
 * Portfolio right after watchlist: Thierry's positions (his posts + console edits); price also fetches the S&P 500 (`^GSPC`) the Portfolio page compares against.
 * FX (daily exchange rates, Yahoo) after peers, before valuation: a fair value computed in the reporting currency is shown in the quote currency.
 * Peers (comparables + analyst targets) after consensus; Valuation (the fair value pyramid) after peers; Analysis after valuation (it reads the Fair Value; one thesis below or above the fair value range, both inside it); Market Reaction beside it (the fair value history and what the price did around each news, code only); Narrative Since after analysis (the month the current story took hold); Evidence after it (every item since that month against each driver, older ones Too old); Narrative State after it (each driver's tag, then the ticker's); Signals last (fair value x the ticker's tag).
 * Cover photos right after content-posts: one photo per own article for the website covers.
 * Content ideas after content-voices (the day's Ideas, scored per channel x format); content-picks after it files the day's 2 posts (best X post, best Substack Note); content-drafts after it writes the drafts Thierry asked for and the picks; content-visuals after it draws each drafted Idea's chart, card, video and news capture.
 * Intraday price (5-minute bars, Yahoo) alone in its stage right after price (Yahoo rate limit): it moves gold.quotes to the latest 5-minute price, so EV, valuation, every judge and the live test read the real price, and market reaction the price at the minute a news item lands.
 * Sandbox accounts and posts after content-visuals (Kevin 2026-11-11): macro-news (Google News, last 24 h) and substack-trending (finance Substacks' best recent posts) feed their angles; each fake account writes 5 posts a day from the skills (content-matrix). Never published.
 * Growth brief last: it reads the subscriber count and outreach the two before it just rebuilt.
 * One signal engine since 2026-11-09: the legacy catalysts / thesis-confidence chain is gone; the WhatsApp alert is the Signal Change.
 * Signal alerts right after signals: a Signal Change that makes the signal better goes to Kevin and Thierry with its picture.
 */
export const DIMENSIONS: readonly Dimension[] = [watchlist, portfolio, companyProfile, news, onedrive, thesis, price, intradayPrice, filingsDimension, onedriveFilings, earnings, financials, consensusDim, peersDim, fxDim, valuationDim, analysis, marketReactionDim, narrativeSinceDim, evidenceDim, narrativeStateDim, signalsDim, signalAlertsDim, contentAccounts, contentPosts, coverPhotos, contentVoices, contentIdeas, contentPicks, contentDrafts, contentVisuals, macroNews, substackTrending, sandboxAccounts, sandboxPosts, contentDispatch, contentReplies, growthOutreach, substackNetwork, growthBriefDim];

/**
 * Growth and content dimensions (Substack crawl, outreach, posts, voices, drafts): the daily schedule only. A deploy's
 * collect runs `core` = everything else, the analysis chain, so it lands in minutes (Kevin 2026-11-05: speed).
 */
export const GROWTH_DIMENSIONS: readonly string[] = ["content-accounts", "content-posts", "cover-photos", "content-voices", "content-ideas", "content-picks", "content-drafts", "content-visuals", "macro-news", "substack-trending", "sandbox-accounts", "sandbox-posts", "content-dispatch", "content-replies", "growth-outreach", "substack-network", "growth-brief"];

/**
 * Stages of a collect (Kevin 2026-11-06: « comment speeder x10 »): the dimensions of one stage run at the same time,
 * stages one after the other. A stage only reads what earlier stages wrote; Yahoo users (company-profile, price,
 * consensus, financials, peers) sit in different stages so they never hit its rate limit together.
 */
export const STAGES: readonly (readonly string[])[] = [
  ["watchlist"],
  ["portfolio", "company-profile"],
  ["news", "onedrive", "price", "filings", "earnings"],
  ["intraday-price"],
  ["thesis", "onedrive-filings", "consensus"],
  ["financials"],
  ["peers"],
  ["fx"],
  ["valuation"],
  ["analysis", "market-reaction"],
  ["narrative-since"],
  ["evidence"],
  ["narrative-state"],
  ["signals"],
  ["signal-alerts"],
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
