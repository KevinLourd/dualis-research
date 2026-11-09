import { and, eq, inArray } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as gold from "@/db/schema/gold";
import { analystTargets, peers, peerSets, type PeerPick } from "@/db/schema/valuation";
import type { Db } from "@/db/types";
import { getJson } from "../../http";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fnv } from "../analysis/facts";
import { YAHOO_HEADERS, yahooSession } from "../consensus/sources";
import { firstJsonObject } from "@/llm/judge";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";

/**
 * Market references for the fair value (Kevin 2026-11-06): the comparable listed companies of each analysed ticker
 * (Claude picks 4 to 6 once per company profile) and, from Yahoo, their EV/EBITDA, P/E and P/B today with size, growth and margins, plus the analyst price
 * targets on the ticker itself. Subjects: `pick:<symbol>` (round 0, Claude), `quote:<yahoo symbol>` (round 1, Yahoo).
 */

export const PEERS_DIMENSION = "peers";
export const PEERS_VERSION = "peers@v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function peersPrompt(p: { symbol: string; name: string | null; market: string | null; sector: string | null; industry: string | null; description: string | null; country: string | null }): string {
  return [
    `Company: ${p.name ?? p.symbol} (${p.symbol}), market ${p.market ?? "?"}, ${[p.sector, p.industry].filter(Boolean).join(" / ") || "sector unknown"}${p.country ? `, ${p.country}` : ""}.`,
    p.description ? `What it does: ${p.description.slice(0, 800)}` : null,
    "",
    "List 4 to 6 LISTED companies an equity analyst would use as trading comparables: same business first, then similar size and region.",
    'JSON only: {"peers": [{"symbol": "<Yahoo Finance symbol, e.g. 005930.KS, 6758.T, MSFT>", "name": "<company name>", "why": "<one short sentence>"}]}',
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export function parsePeers(text: string, self: string): PeerPick[] {
  // The first JSON object only: the model sometimes adds a line after it (2026-11-06, CCLD).
  const o = JSON.parse(firstJsonObject(text)) as { peers?: { symbol?: unknown; name?: unknown; why?: unknown }[] };
  const list = (o.peers ?? []).filter((p) => typeof p.symbol === "string" && p.symbol.trim() && p.symbol.trim().toUpperCase() !== self.toUpperCase());
  if (list.length === 0) throw new Error("peers: no comparable company in the answer");
  return list.slice(0, 6).map((p) => ({ symbol: String(p.symbol).trim().toUpperCase(), name: stripDashes(String(p.name ?? p.symbol)), why: stripDashes(String(p.why ?? "")) }));
}

async function profileOf(db: Db, symbol: string) {
  const [[t], [p]] = await Promise.all([
    db.select({ market: gold.tickers.market }).from(gold.tickers).where(eq(gold.tickers.symbol, symbol)),
    db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)),
  ]);
  return { symbol, name: p?.name ?? null, market: t?.market ?? null, sector: p?.sector ?? null, industry: p?.industry ?? null, description: p?.description ?? null, country: p?.country ?? null };
}

export const pickSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: (s) => s.startsWith("pick:"),
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("peers: needs the database");
    const symbol = subject.slice(5);
    const prompt = peersPrompt(await profileOf(ctx.db, symbol));
    const inputHash = fnv(`${PEERS_VERSION}\n${prompt}`);
    const [done] = await ctx.db.select({ id: peerSets.id }).from(peerSets).where(and(eq(peerSets.symbol, symbol), eq(peerSets.inputHash, inputHash)));
    if (done) return { request: { symbol, inputHash, reusedFrom: done.id }, httpStatus: null, payload: { inputHash, reused: true } };
    if (!ctx.complete) throw new Error("peers: no LLM in the collector context (cli.ts sets ctx.complete)");
    const r = await ctx.complete({ system: "You pick trading comparables for an equity analyst. Answer with JSON only, no prose. No em dash.", prompt });
    return { request: { symbol, inputHash }, httpStatus: null, payload: { inputHash, peers: parsePeers(r.text, symbol), model: r.model } };
  },
};

type Raw = { raw?: number } | undefined;
type QuoteSummary = {
  quoteSummary?: {
    result?: {
      price?: { longName?: string; shortName?: string; currency?: string; marketCap?: Raw };
      summaryDetail?: { trailingPE?: Raw; forwardPE?: Raw; marketCap?: Raw; currency?: string };
      defaultKeyStatistics?: { enterpriseToEbitda?: Raw; priceToBook?: Raw; forwardPE?: Raw };
      financialData?: { targetLowPrice?: Raw; targetMeanPrice?: Raw; targetHighPrice?: Raw; numberOfAnalystOpinions?: Raw; financialCurrency?: string; revenueGrowth?: Raw; ebitdaMargins?: Raw };
    }[];
  };
};
const num = (v: Raw) => (typeof v?.raw === "number" && Number.isFinite(v.raw) ? v.raw : null);

export const quoteSource: Source = {
  name: "yahoo",
  requiredEnv: [],
  covers: (s) => s.startsWith("quote:"),
  async fetch(subject: string, ctx: SourceContext): Promise<FetchOutcome> {
    const symbol = subject.slice(6);
    const session = await yahooSession(ctx);
    const path = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics,financialData`;
    if (!session.crumb) return { request: { url: path }, httpStatus: null, error: session.error ?? "Yahoo gave no crumb" };
    const headers = { ...YAHOO_HEADERS, ...(session.cookie ? { Cookie: session.cookie } : {}) };
    if (!process.env.VITEST) await sleep(400);
    const out = await getJson(ctx, `${path}&crumb=${encodeURIComponent(session.crumb)}`, { url: path }, { headers });
    if (!out.error && !(out.payload as QuoteSummary)?.quoteSummary?.result?.[0]) return { ...out, error: "Yahoo returned no summary for this symbol" };
    return out;
  },
};

/** A multiple a peer trades at: positive and below a sanity cap (a negative or absurd one is not a multiple). */
const multiple = (x: number | null, cap: number) => (x !== null && x > 0 && x < cap ? x : null);

/** What one Yahoo summary says: name, currency, multiples today, size, growth, margins, analyst targets. */
export function readSummary(payload: unknown) {
  const r = (payload as QuoteSummary).quoteSummary!.result![0];
  const ev = num(r.defaultKeyStatistics?.enterpriseToEbitda);
  const pe = num(r.summaryDetail?.trailingPE);
  const peForward = num(r.summaryDetail?.forwardPE) ?? num(r.defaultKeyStatistics?.forwardPE);
  const pb = num(r.defaultKeyStatistics?.priceToBook);
  const t = r.financialData;
  const low = num(t?.targetLowPrice);
  const mean = num(t?.targetMeanPrice);
  const high = num(t?.targetHighPrice);
  return {
    name: r.price?.longName ?? r.price?.shortName ?? null,
    currency: r.price?.currency ?? r.summaryDetail?.currency ?? null,
    evEbitda: multiple(ev, 200),
    pe: multiple(pe, 500),
    peForward: multiple(peForward, 500),
    pb: multiple(pb, 100),
    marketCap: num(r.price?.marketCap) ?? num(r.summaryDetail?.marketCap),
    revenueGrowth: num(r.financialData?.revenueGrowth),
    ebitdaMargin: num(r.financialData?.ebitdaMargins),
    targets: low !== null && mean !== null && high !== null && mean > 0 ? { low, mean, high, analysts: num(t?.numberOfAnalystOpinions) } : null,
  };
}

/** The current peer set of each ticker: its latest pick in silver. */
async function currentSets(db: Db, symbols: string[]): Promise<Map<string, PeerPick[]>> {
  const rows = symbols.length ? await db.select({ symbol: peerSets.symbol, peers: peerSets.peers, createdAt: peerSets.createdAt }).from(peerSets).where(inArray(peerSets.symbol, symbols)) : [];
  const out = new Map<string, { at: Date; peers: PeerPick[] }>();
  for (const r of rows) if (!out.has(r.symbol) || out.get(r.symbol)!.at < r.createdAt) out.set(r.symbol, { at: r.createdAt, peers: r.peers });
  return new Map([...out].map(([k, v]) => [k, v.peers]));
}

async function storePicks(db: Db, fetches: BronzeFetch[]): Promise<number> {
  let n = 0;
  for (const f of fetches.filter((x) => !x.error && x.source === "claude")) {
    const p = f.payload as { inputHash: string; peers?: PeerPick[]; model?: string; reused?: boolean };
    if (p.reused || !p.peers) continue;
    await db.insert(peerSets).values({ symbol: f.subject.slice(5), inputHash: p.inputHash, peers: p.peers, model: p.model ?? null, bronzeId: f.id, createdAt: f.fetchedAt });
    n++;
  }
  return n;
}

export const peersDim: Dimension = {
  name: PEERS_DIMENSION,
  description: "Comparable listed companies per analysed ticker (Claude picks them once per company profile) with their EV/EBITDA, P/E and P/B today, size, growth and margins, and the analyst price targets on the ticker (Yahoo). The fair value's multiple methods price base and high off these peers; Analyst price targets reads the targets.",
  sources: [pickSource, quoteSource],
  subjects: async (db) => (await analysedSymbols(db)).map((s) => `pick:${s}`),
  // Round 1: the picks of round 0 are in silver once stored; quote the ticker itself (targets) and each peer.
  expand: async (db, soFar, round) => {
    if (round !== 1) return [];
    await storePicks(db, soFar);
    const symbols = soFar.filter((f) => f.source === "claude").map((f) => f.subject.slice(5));
    const sets = await currentSets(db, symbols);
    return [...new Set(symbols.flatMap((s) => [`quote:${s}`, ...(sets.get(s) ?? []).map((p) => `quote:${p.symbol}`)]))];
  },
  // The picks were stored at the end of round 0 (`expand`), before the peers were quoted.
  promote: async (db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: await rebuildPeersGold(db, fetches) }),
};

/** gold.peers + gold.analyst_targets from this run's Yahoo answers (a quote that failed this run keeps no row). */
export async function rebuildPeersGold(db: Db, fetches: BronzeFetch[], now = new Date()): Promise<Record<string, number>> {
  const symbols = [...new Set(fetches.filter((f) => f.source === "claude").map((f) => f.subject.slice(5)))];
  const sets = await currentSets(db, symbols);
  const quotes = new Map(fetches.filter((f) => f.source === "yahoo" && !f.error).map((f) => [f.subject.slice(6), readSummary(f.payload)]));
  const peerRows: (typeof peers.$inferInsert)[] = [];
  const targetRows: (typeof analystTargets.$inferInsert)[] = [];
  for (const symbol of symbols) {
    for (const p of sets.get(symbol) ?? []) {
      const q = quotes.get(p.symbol);
      if (!q) continue;
      peerRows.push({ id: `${symbol}|${p.symbol}`, symbol, peerSymbol: p.symbol, name: q.name ?? p.name, why: p.why, currency: q.currency, evEbitda: q.evEbitda, pe: q.pe, peForward: q.peForward, pb: q.pb, marketCap: q.marketCap, revenueGrowth: q.revenueGrowth, ebitdaMargin: q.ebitdaMargin, sources: ["claude", "yahoo"], asOf: now });
    }
    const own = quotes.get(symbol);
    if (own?.targets) targetRows.push({ symbol, ...own.targets, analysts: own.targets.analysts === null ? null : Math.round(own.targets.analysts), currency: own.currency, sources: ["yahoo"], asOf: now });
  }
  await db.transaction(async (tx) => {
    if (symbols.length) {
      await tx.delete(peers).where(inArray(peers.symbol, symbols));
      await tx.delete(analystTargets).where(inArray(analystTargets.symbol, symbols));
    }
    if (peerRows.length) await tx.insert(peers).values(peerRows);
    if (targetRows.length) await tx.insert(analystTargets).values(targetRows);
  });
  return { claude: sets.size, yahoo: peerRows.length + targetRows.length };
}
