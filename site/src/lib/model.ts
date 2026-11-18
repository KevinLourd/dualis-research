/** Prices Thierry and Kevin settled on for the launch (2026-11-04). One place to change them. */
export const PLANS = {
  monthly: { price: 59, period: "month" },
  annual: { price: 590, period: "year" },
} as const;

export const BRAND = "Dualis Research";

export const DISCLAIMER = "Not investment advice. For information only. The author may hold positions in the securities discussed.";

/** Where every Subscribe button goes: Thierry's Substack subscribe page, once he has set it in the console. */
export function subscribeHref(substackUrl: string | null): string | null {
  return substackUrl ? `${substackUrl.replace(/\/$/, "")}/subscribe` : null;
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "June 2026", the timeline's date. */
export function formatMonth(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The portfolio's year-to-date performance: the end of the curve in Thierry's post "Up 45%+ YTD vs 11.5% for the
 * S&P500" (Analysis Paralysis, 2026-10-16), +56% vs +14% (`track-record.ts`), so the figures and the chart beside them
 * say the same thing (Kevin 2026-11-18: « +56% partout, comme sur le graph »). The 45% lives only in that report's own
 * title. Replace with the brokerage statement figure when he shares it.
 */
export const TRACK_RECORD = {
  ytdPct: 56,
  benchmark: "S&P 500",
  benchmarkPct: 14,
  asOf: "2026-10-16",
  sourceUrl: "https://analysisparalysis888.substack.com/p/up-45-ytd-vs-115-for-the-s-and-p500",
  note: "Portfolio return year to date as of October 16, 2026, as published on Substack. Gross of fees, not audited. Past performance does not guarantee future results.",
} as const;

/** Markets the coverage universe spans (the console collects filings and prices for each). */
/** Markets covered. Never where Thierry lives (Kevin 2026-11-06; copy.test.ts). */
export const MARKETS = ["Japan", "Korea", "Hong Kong", "Canada", "United States", "United Kingdom", "Australia"] as const;

/** Thierry's Substack profile: messages reach him there. */
export const SUBSTACK_PROFILE_URL = "https://substack.com/@analysisparalysis888";

export const LINKEDIN_URL = "https://www.linkedin.com/in/thierrymatin/";
/** Thierry's X account (WhatsApp 2026-11-04). */
export const X_URL = "https://x.com/quantum_macro";
export const X_HANDLE = "@quantum_macro";

/**
 * His two best calls, in his words (WhatsApp 2026-11-04): "both did above 40% returns". `result` = what he published
 * (Miraial: "Closed: ~45% return", Analysis Paralysis 2026-10-16; Quantum: "above 40%"). `report` = a word of the
 * report's title, to link it; `line` = the thesis in one line, from his report.
 */
export const BEST_CALLS = [
  { name: "Miraial", ticker: "4238 JP", side: "Long", result: "+45%", resultNote: "closed", report: "wafer", line: "Wafer carriers at 8.5x earnings, bought as the chip cycle bottomed." },
  { name: "Quantum Corp", ticker: "QMCO", side: "Short", result: "40%+", resultNote: "gain on the short", report: "Quantum", line: "A hyped story with a backlog about to run out." },
] as const;

/**
 * The research portal's four shelves, titles and lines in Thierry's words (2026-11-17). Filed by a stored judgment in
 * the console's collector (`research-category@v2`).
 */
export type ResearchCategory = "coverage" | "primer" | "update" | "other";
export const CATEGORIES: { key: ResearchCategory; number: string; title: string; short: string; body: string }[] = [
  {
    key: "coverage",
    number: "01",
    title: "Deep Dives",
    short: "Deep Dive",
    body: "Single-company write-ups, long or short. We zero in on the few drivers that move the business and where we think the market has them wrong. Names we own in the portfolio will be clearly identified, and watchlist names will be tracked for future review.",
  },
  {
    key: "primer",
    number: "02",
    title: "Industry/Thematic Primers",
    short: "Primer",
    body: "We map industries and themes where fundamentals are starting to accelerate, and the market hasn’t caught on yet. That is where we expect mispricings to show up. Each primer explains what is driving the change and which companies are most exposed to it.",
  },
  {
    key: "update",
    number: "03",
    title: "Updates",
    short: "Update",
    body: "Follow-ups on ideas we’ve published: earnings, filings, catalysts hit or missed, and any change to our view. When a thesis has played out or broken, we close it and explain why.",
  },
  {
    key: "other",
    number: "04",
    title: "Other",
    short: "Other",
    body: "Write-ups on our investment process, the current market environment, and anything else we deem relevant to our readers’ attention.",
  },
];

export function categoryLabel(key: ResearchCategory | null): string {
  return CATEGORIES.find((c) => c.key === key)?.short ?? "Research";
}

/** Posts of one shelf, or every post for "all". A post not filed yet shows only under "all". */
export function shelf<T extends { category: ResearchCategory | null }>(posts: T[], key: ResearchCategory | "all"): T[] {
  return key === "all" ? posts : posts.filter((p) => p.category === key);
}

/** Small deterministic PRNG (mulberry32) seeded from a string: the same post always gets the same cover. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Node = { x: number; y: number; r: number; cluster: number };
export type Edge = { a: number; b: number; cross: boolean };

/**
 * A value-chain constellation: `clusters` industries laid left to right, a few dots each, linked inside an industry
 * and across neighbours (the chain). Deterministic from the seed. Coordinates in a w x h box.
 */
export function constellation(seed: string, w: number, h: number, clusters = 5, perCluster = 6): { nodes: Node[]; edges: Edge[] } {
  const rnd = seeded(seed);
  const nodes: Node[] = [];
  const pad = Math.min(w, h) * 0.1;
  const step = (w - pad * 2) / clusters;
  for (let c = 0; c < clusters; c++) {
    const cx = pad + step * (c + 0.5);
    const cy = h * (0.3 + rnd() * 0.4);
    for (let i = 0; i < perCluster; i++) {
      const angle = rnd() * Math.PI * 2;
      const dist = (0.15 + rnd() * 0.85) * Math.min(step * 0.45, h * 0.3);
      nodes.push({ x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, r: i === 0 ? 3.2 : 1.4 + rnd() * 1.4, cluster: c });
    }
  }
  const edges: Edge[] = [];
  for (let c = 0; c < clusters; c++) {
    const own = nodes.map((n, i) => [n, i] as const).filter(([n]) => n.cluster === c);
    const hub = own[0][1];
    for (const [, i] of own.slice(1)) edges.push({ a: hub, b: i, cross: false });
    if (own.length > 2) edges.push({ a: own[1][1], b: own[2][1], cross: false });
    if (c + 1 < clusters) {
      const next = nodes.map((n, i) => [n, i] as const).filter(([n]) => n.cluster === c + 1);
      edges.push({ a: hub, b: next[0][1], cross: true });
      edges.push({ a: own[1 + Math.floor(rnd() * (own.length - 1))][1], b: next[1 + Math.floor(rnd() * (next.length - 1))][1], cross: true });
    }
  }
  return { nodes, edges };
}
