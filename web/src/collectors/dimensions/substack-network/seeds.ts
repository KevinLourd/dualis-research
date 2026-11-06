/**
 * Where the crawl starts (publication ids read once from each archive) and who it must not propose. Hand-kept from docs/acquisition-targets.md (targets + the
 * small-cap writers the first crawl started from) and docs/references.md (Thierry's references): edit there and here.
 */
export const SEEDS = [
  // Targets (docs/acquisition-targets.md)
  { host: "www.asiancenturystocks.com", id: "91354" },
  { host: "www.overlookedalpha.com", id: "97545" },
  { host: "www.readideabrunch.com", id: "494832" },
  { host: "dirtcheapstocks.substack.com", id: "2329765" },
  { host: "thevalueroad.substack.com", id: "3235635" },
  { host: "valueinvestingworld.substack.com", id: "46070" },
  { host: "www.hiddengemsinvesting.com", id: "3352520" },
  { host: "www.capitalemployed.com", id: "407562" },
  { host: "treasure-hunting.co", id: "748312" },
  { host: "www.valuedontlie.com", id: "22848" },
  // Small-cap / special-situation writers of the first crawl
  { host: "microcapnewsletter.substack.com", id: "271436" },
  { host: "altaycap.substack.com", id: "1294679" },
  { host: "www.yetanothervalueblog.com", id: "35915" },
  { host: "mscliffnotes.substack.com", id: "1389551" },
  { host: "investingwithwes.substack.com", id: "1086362" },
  { host: "stockpicking.substack.com", id: "102182" },
  { host: "darksideofthestreet.substack.com", id: "663357" },
  { host: "skepticallyoptimistic.substack.com", id: "2273220" },
  { host: "undervaluedjapan.substack.com", id: "1037935" },
  // Thierry's references (docs/references.md)
  { host: "www.citriniresearch.com", id: "836125" },
  { host: "read.aurelionresearch.com", id: "5655476" },
  { host: "www.archetype-research.com", id: "296544" },
  { host: "deepvaluecapitalbykyler.substack.com", id: "2753472" },
  { host: "www.byronstreetresearch.com", id: "2373943" },
] as const;
export const SEED_HOSTS: readonly string[] = SEEDS.map((x) => x.host);

/**
 * Hosts every call goes through. Substack's Cloudflare challenges datacenter IPs (GitHub Actions) on substack.com
 * and *.substack.com (HTTP 403 "Just a moment..."), not on publications' own domains, which serve the same API for
 * any publication id or handle. Calls rotate over them; a 403 / 429 moves on to the next one.
 */
export const GATEWAYS: readonly string[] = SEED_HOSTS.filter((h) => !h.endsWith(".substack.com"));

/** Thierry's own Substack: its subscriber count is the November goal's series. */
export const OWN = { handle: "analysisparalysis888", publicationId: "5953722", host: "analysisparalysis888.substack.com" } as const;

/** Authors never proposed as active targets (Substack author handle -> why), from docs/acquisition-targets.md. */
export const EXCLUDED_AUTHORS: Record<string, string> = {
  yavb: "Yet Another Value Blog: Andrew Walker stopped writing on 2026-10-23 (joined Bridgewater).",
  clarksquarecapital: "Clark Square Capital: paused since 2026-07-07 (new baby). Retry in December.",
};

/** A target with no post for this many days is flagged inactive. */
export const INACTIVE_AFTER_DAYS = 60;
/** Candidates kept for the ranking: niche keyword + recommended by at least MIN_INBOUND crawled publications. */
export const MAX_CANDIDATES = 60;
export const MIN_INBOUND = 2;
/** Safety bound on recommendation lists fetched in one run (2 hops from the seeds is ~400). */
export const MAX_RECOMMENDATION_FETCHES = 800;

export const NICHE = /micro.?cap|small.?cap|special sit|value invest|deep value|net.?net|japan|korea|asia|undervalued|stock|equit|invest|compounder|research|idea/i;
