import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { KPI_LEVELS, KPI_VERDICTS, kpiDrivers, type DocCitation, type KpiLevel, type KpiRelease, type KpiTestRow, type KpiVerdict } from "@/db/schema/analysis";
import { documentPages, documents } from "@/db/schema/documents";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { BronzeFetch } from "@/db/schema/bronze";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { firstJsonObject } from "@/llm/judge";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { fmt, fnv } from "../analysis/facts";
import { seriesCatalog, type StoredSeries } from "../analysis/series";
import { verifyQuote } from "../filing-documents/read";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";

/**
 * KPI Drivers (Kevin + Thierry 2026-11-19, private `docs/meeting-2026-11-19.md`). Per ticker:
 * 1) releases (code): every results report of the last 3 years (`gold.documents`) and the price over the 5 trading
 *    days after it vs the S&P 500 (« the shorter term signals are the pure signals »);
 * 2) candidates (AI, once per set of reports): the fundamental KPIs that move THIS business, read from its business
 *    model and what management writes in the reports, any number of them (0 is an answer), each mapped to a stored
 *    series or approximated from stored figures, else read in the reports' words;
 * 3) one test per KPI (AI): every release judged confirms / invalidates / neutral (« invalidated when the KPI moves
 *    strongly and the price does not react »), each with its figure and a quote checked on its page; then strong /
 *    weak / none, and whether it turns NOW at the latest release (signal).
 */

export const KPI_DIMENSION = "kpi-drivers";
export const KPI_YEARS = 3;
export const REACTION_DAYS = 5;
/** v2 (Kevin 2026-11-19, Worldex: the why ran to 4 lines in the panel): a why of at most 15 words. */
export const CANDIDATES_QUESTION = "kpi-candidates@v2";
/** v3 (Kevin 2026-11-19): an invalidation weighs (one caps at weak, two or more = none); a strong turn needs a strong KPI; the reason is a plain 15-word conclusion. */
/** v4 (Kevin 2026-11-19: « pas de règle de proportion… laisse l'AI décider »): no count rule, the judge weighs every release. */
export const TEST_QUESTION = "kpi-test@v4";
/** Pages of each report a judge reads (the results discussion first) and how much of each page. */
const PAGES_PER_RELEASE = 2;
const PAGE_CHARS = 3_500;
const DAY = 86_400_000;

type Release = KpiRelease & { pages: { page: number; text: string }[] };
export type KpiCandidate = { name: string; why: string; series: string | null; approximation: string | null };
type Test = { level: KpiLevel; reason: string; rows: KpiTestRow[]; signal: KpiLevel | null; signalWhy: string | null; direction: "up" | "down" | null };

const signedPct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

/** The return from the last close before `day` to the close `n` trading days later, from daily closes (oldest first). */
export function reactionAfter(bars: { date: string; close: number }[], day: string, n = REACTION_DAYS): number | null {
  const i = bars.findIndex((b) => b.date >= day);
  if (i <= 0 || i + n - 1 >= bars.length) return null;
  return bars[i + n - 1].close / bars[i - 1].close - 1;
}

/** Every results report of the last 3 years with its 5-day reaction vs the S&P 500 and its best results pages. */
export async function releasesOf(db: Db, symbol: string, now = new Date()): Promise<Release[]> {
  const since = new Date(now.getTime() - KPI_YEARS * 365.25 * DAY);
  const [docs, stock, bench] = await Promise.all([
    db.select().from(documents).where(and(eq(documents.symbol, symbol), gte(documents.filedAt, since))).orderBy(asc(documents.filedAt)),
    db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(eq(gold.priceBars.symbol, symbol)).orderBy(asc(gold.priceBars.date)),
    db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(eq(gold.priceBars.symbol, "^GSPC")).orderBy(asc(gold.priceBars.date)),
  ]);
  if (docs.length === 0) return [];
  const pages = await db.select().from(documentPages).where(inArray(documentPages.documentId, docs.map((d) => d.id))).orderBy(asc(documentPages.page));
  return docs.map((d) => {
    const day = d.filedAt.toISOString().slice(0, 10);
    const s = reactionAfter(stock, day);
    const b = reactionAfter(bench, day);
    const own = pages.filter((p) => p.documentId === d.id);
    return { id: d.id, day, title: d.title, stock: s, bench: b, reaction: s === null ? null : s - (b ?? 0), pages: bestPages(own) };
  });
}

/** The pages most likely to discuss results and KPIs: the ones dense in figures and results words, in page order. */
function bestPages(pages: { page: number; text: string }[]): { page: number; text: string }[] {
  const words = /(results|revenue|sales|margin|order|backlog|utiliz|capacity|매출|영업이익|수주|가동률|실적|売上|営業利益|受注)/gi;
  const score = (t: string) => (t.match(words)?.length ?? 0) + Math.min(20, (t.match(/\d[\d,.]{2,}/g)?.length ?? 0) / 5);
  return [...pages]
    .sort((a, b) => score(b.text) - score(a.text))
    .slice(0, PAGES_PER_RELEASE)
    .sort((a, b) => a.page - b.page)
    .map((p) => ({ page: p.page, text: p.text.slice(0, PAGE_CHARS) }));
}

/** The figures a series holds for the period just reported at a release, beside the same period a year earlier. */
export function seriesAt(s: StoredSeries, day: string): string | null {
  const at = Date.parse(`${day}T00:00:00Z`);
  const ends = [...s.points.keys()].filter((p) => {
    const t = Date.parse(`${p.length === 7 ? `${p}-28` : p}T00:00:00Z`);
    return t < at && at - t <= 140 * DAY;
  });
  const p = ends.sort().at(-1);
  if (!p) return null;
  const prior = `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
  return `${s.label} [${s.key}], period ended ${p}: ${fmt(s.points.get(p), s.unit)} vs ${fmt(s.points.get(prior), s.unit)} a year earlier`;
}

/**
 * One stored LLM answer per (kind, subject, key): asked once, read back after. Stored only once it parses: an answer
 * that skips a release would otherwise be read back and fail every run after (Worldex, 2026-11-19).
 */
async function once<T>(db: Db, complete: Complete, kind: string, subjectId: string, key: string, question: string, system: string, prompt: string, parse: (text: string) => Promise<T> | T): Promise<T> {
  const [hit] = await db.select().from(silver.judgments).where(and(eq(silver.judgments.subjectKind, kind), eq(silver.judgments.subjectId, subjectId), eq(silver.judgments.questionKey, key)));
  if (hit) return parse((hit.raw as { text: string }).text);
  const r = await complete({ system, prompt });
  const parsed = await parse(r.text);
  await db.insert(silver.judgments).values({ subjectKind: kind, subjectId, questionKey: key, question, verdict: "answered", probability: 1, citedSentence: null, reason: null, model: r.model, raw: { text: r.text } }).onConflictDoNothing();
  return parsed;
}

const releasesText = (rs: Release[], withPages: boolean) =>
  rs
    .map((r, i) =>
      [
        `R${i + 1} ${r.day} ${r.title}: price ${signedPct(r.stock)} over the next ${REACTION_DAYS} trading days, S&P 500 ${signedPct(r.bench)}, so ${signedPct(r.reaction)} against the market.`,
        ...(withPages ? r.pages.map((p) => `  [R${i + 1} page ${p.page}]\n${p.text}`) : []),
      ].join("\n"),
    )
    .join("\n\n");

export const CANDIDATES_SYSTEM = [
  "You are the equity research associate of a small-cap long/short analyst. He trusts only fundamental KPIs: figures about the business that the market trades the stock on.",
  "List every KPI that drives THIS business, from its business model and from what management itself writes in its reports (the KPIs it reports, discusses and explains results with).",
  "Know what drives each kind of business (capacity utilization for a manufacturer, same-store sales for a retailer, backlog for a contractor, net interest margin for a bank...). When the company does not report one, say how to approximate it from what it reports (capacity utilization ~ revenue / PP&E).",
  "Any number of KPIs: none when nothing fundamental drives it, twenty if there are twenty. Never a price, a valuation multiple or a market-wide factor.",
  "series = the stored series key that holds it, copied exactly from the list (null when none does); approximation = the formula from stored keys, else null.",
  "No em dash. JSON only, no prose, no code fence:",
  '{"kpis": [{"name": "Operating margin", "why": "<at most 15 words: why it moves this business>", "series": "qmetric:operating-margin" | null, "approximation": string | null}]}',
].join("\n");

export const TEST_SYSTEM = [
  "You test ONE hypothesis for a small-cap long/short analyst: « this KPI moves this stock ». A hypothesis is checked against every results release, like a scientist.",
  "For each release: read what the KPI did (from the figures given, else from the report's own words and tables), compare with the price over the 5 trading days after, against the S&P 500.",
  "verdict: confirms = the KPI changed clearly and the price moved the way that change implies; invalidates = the KPI changed strongly and the price did not react, or moved the other way; neutral = the KPI barely changed, or something else clearly moved the price.",
  "Every release gets a row. from / to / change = the KPI values the release shows (with units), null when the release does not show it. why = at most 15 words, the fact. cite = the release label, page and an EXACT quote of the report that shows the figure or management's words about it, null when none.",
  "level: decide it yourself, as the analyst would, from everything above: never by counting. Weigh each release: how big the KPI move was, how clear the price reaction was against the market, whether another fact in the same report (another KPI, a one-off, a guidance change) or the market at large could explain the reaction, and whether the confirmations are recent. A small cap's price is noisy: one contrary release can be noise, a clean, large KPI move the price ignored says much more. strong = the market clearly trades the stock on this KPI; weak = it does sometimes, or the evidence is thin; none = it does not.",
  "reason = ONE plain sentence, at most 15 words, that a reader landing on the page understands at once: the conclusion about how the stock reacts to this KPI (\"The stock usually follows revenue growth, but not in the last two releases.\"). No dates, no list of figures, no R label: the release table shows them.",
  "signal (only when level is strong or weak, else null): does the KPI turn NOW, at the latest release, by enough to change the story, with the price not reacting yet? strong (only for a strong KPI) / weak / none. signalWhy = one sentence with the figure. direction = up or down, the way the KPI moved at the latest release.",
  "No em dash. JSON only, no prose, no code fence:",
  '{"rows": [{"release": "R1", "verdict": "confirms" | "invalidates" | "neutral", "from": string | null, "to": string | null, "change": string | null, "why": string, "cite": {"release": "R1", "page": 12, "quote": "<exact words>"} | null}], "level": "strong" | "weak" | "none", "reason": string, "signal": "strong" | "weak" | "none" | null, "signalWhy": string | null, "direction": "up" | "down" | null}',
].join("\n");

export function parseCandidates(text: string, catalog: Map<string, StoredSeries>): KpiCandidate[] {
  const obj = JSON.parse(firstJsonObject(text)) as { kpis?: unknown };
  if (!Array.isArray(obj.kpis)) throw new Error(`kpi-drivers: answer has no kpis array: ${text.slice(0, 200)}`);
  return obj.kpis.flatMap((k) => {
    const x = k as Record<string, unknown>;
    if (typeof x.name !== "string" || !x.name.trim() || typeof x.why !== "string") return [];
    const series = typeof x.series === "string" && catalog.has(x.series) ? x.series : null;
    return [{ name: stripDashes(x.name.trim()), why: stripDashes(x.why.trim()), series, approximation: typeof x.approximation === "string" && x.approximation.trim() ? stripDashes(x.approximation.trim()) : null }];
  });
}

/** A test answer: one row per release (a missing one = an error), quotes kept only when printed on their page. */
export async function parseTest(db: Db, text: string, releases: Release[]): Promise<Test> {
  const obj = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (!KPI_LEVELS.includes(obj.level as KpiLevel)) throw new Error(`kpi-drivers: level "${String(obj.level)}" is not one of ${KPI_LEVELS.join(", ")}`);
  if (typeof obj.reason !== "string" || !obj.reason.trim()) throw new Error("kpi-drivers: no reason");
  const byLabel = new Map(releases.map((r, i) => [`R${i + 1}`, r]));
  const answered = new Map((Array.isArray(obj.rows) ? obj.rows : []).map((r) => [String((r as { release?: unknown }).release), r as Record<string, unknown>]));
  const rows: KpiTestRow[] = [];
  for (const [label, r] of byLabel) {
    const x = answered.get(label);
    if (!x) throw new Error(`kpi-drivers: no row for ${label}`);
    if (!KPI_VERDICTS.includes(x.verdict as KpiVerdict)) throw new Error(`kpi-drivers: verdict "${String(x.verdict)}" for ${label}`);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? stripDashes(v.trim()) : null);
    let cite: DocCitation | null = null;
    const c = x.cite as { release?: unknown; page?: unknown; quote?: unknown } | null;
    if (c && typeof c.page === "number" && typeof c.quote === "string" && byLabel.get(String(c.release))) {
      const doc = byLabel.get(String(c.release))!;
      if (await verifyQuote(db, doc.id, c.page, c.quote)) cite = { documentId: doc.id, page: c.page, quote: c.quote, title: doc.title, filedAt: doc.day };
    }
    rows.push({ releaseId: r.id, day: r.day, title: r.title, reaction: r.reaction, from: str(x.from), to: str(x.to), change: str(x.change), verdict: x.verdict as KpiVerdict, why: str(x.why) ?? "", cite });
  }
  const level = obj.level as KpiLevel;
  const asked = level !== "none" && KPI_LEVELS.includes(obj.signal as KpiLevel) ? (obj.signal as KpiLevel) : null;
  // A strong turn needs a KPI the market has shown it trades on (Kevin 2026-11-19): a weak KPI's turn is weak at most.
  const signal = asked === "strong" && level !== "strong" ? "weak" : asked;
  return {
    level,
    reason: stripDashes(obj.reason.trim()),
    rows,
    signal,
    signalWhy: signal && typeof obj.signalWhy === "string" ? stripDashes(obj.signalWhy.trim()) : null,
    direction: obj.direction === "up" || obj.direction === "down" ? obj.direction : null,
  };
}

export type KpiPayload = { symbol: string; drivers: (KpiCandidate & Test)[] };

/** One ticker end to end: releases, candidates, one test per candidate. */
export async function judgeKpis(db: Db, complete: Complete, symbol: string): Promise<KpiPayload> {
  const releases = await releasesOf(db, symbol);
  const catalog = await seriesCatalog(db, symbol);
  const [profile] = await db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
  const company = `${symbol}${profile?.name ? ` (${profile.name})` : ""}${profile?.industry ? `, ${profile.industry}` : ""}. ${profile?.description ?? ""}`.trim();
  const keys = [...catalog.values()].filter((s) => /^(line|hline|qline|metric|qmetric):/.test(s.key)).map((s) => `${s.label} [${s.key}]`);
  const docKey = fnv(releases.map((r) => r.id).join(","));
  const latest = releases.slice(-4);
  const candidates = await once(
    db,
    complete,
    "kpi-candidates",
    symbol,
    `${CANDIDATES_QUESTION}:${docKey}:${fnv(keys.join("|"))}`,
    `${CANDIDATES_QUESTION}: which fundamental KPIs drive ${symbol}?`,
    CANDIDATES_SYSTEM,
    [`Company: ${company}`, "", "Stored series:", keys.join("\n") || "none", "", "Its latest reports (best pages):", releasesText(latest, true)].join("\n"),
    (text) => parseCandidates(text, catalog),
  );
  const drivers: (KpiCandidate & Test)[] = [];
  for (const k of candidates) {
    const s = k.series ? catalog.get(k.series) : undefined;
    const figures = releases.map((r, i) => `R${i + 1}: ${(s && seriesAt(s, r.day)) ?? "no stored figure: read it in the report"}`).join("\n");
    const test = await once(
      db,
      complete,
      "kpi-test",
      `${symbol}:${k.name}`,
      `${TEST_QUESTION}:${docKey}:${fnv(`${k.name}|${k.series}|${k.approximation}|${figures}`)}`,
      `${TEST_QUESTION}: does « ${k.name} » move ${symbol}?`,
      TEST_SYSTEM,
      [
        `Company: ${company}`,
        `KPI: ${k.name}. ${k.why}${k.approximation ? ` Approximated as ${k.approximation}.` : ""}`,
        "",
        "Its stored figure at each release:",
        figures,
        "",
        `Every results release of the last ${KPI_YEARS} years, oldest first, with the price reaction and the report's best pages:`,
        releasesText(releases, true),
        "",
        `Answer exactly ${releases.length} rows, one per release, R1 to R${releases.length}, none skipped.`,
      ].join("\n"),
      (text) => parseTest(db, text, releases),
    );
    drivers.push({ ...k, ...test });
  }
  return { symbol, drivers };
}

export const kpiSource: Source = {
  name: "claude",
  requiredEnv: ["CLAUDE_OAUTH_TOKEN"],
  covers: () => true,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("kpi-drivers: needs the database");
    if (!ctx.complete) throw new Error("kpi-drivers: no LLM in the collector context (cli.ts sets ctx.complete)");
    const releases = await releasesOf(ctx.db, symbol);
    if (releases.length === 0) return { request: { symbol }, httpStatus: null, error: "no results report stored for the last 3 years" };
    return { request: { symbol, releases: releases.length }, httpStatus: null, payload: await judgeKpis(ctx.db, ctx.complete, symbol) };
  },
};

/** gold.kpi_drivers of every ticker answered in this run, from its latest payload. */
export async function promoteKpis(db: Db, fetches: BronzeFetch[]): Promise<number> {
  const latest = new Map<string, KpiPayload>();
  for (const f of fetches.filter((x) => !x.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f.payload as KpiPayload);
  let n = 0;
  for (const [symbol, p] of latest) {
    const rows = p.drivers.map((d, i) => ({
      id: `${symbol}:kpi:${i + 1}`,
      symbol,
      rank: i + 1,
      name: d.name,
      why: d.why,
      series: d.series,
      approximation: d.approximation,
      level: d.level,
      reason: d.reason,
      rows: d.rows,
      confirmed: d.rows.filter((r) => r.verdict === "confirms").length,
      invalidated: d.rows.filter((r) => r.verdict === "invalidates").length,
      signal: d.signal,
      signalWhy: d.signalWhy,
      direction: d.direction,
      asOf: new Date(),
    }));
    await db.transaction(async (tx) => {
      await tx.delete(kpiDrivers).where(eq(kpiDrivers.symbol, symbol));
      if (rows.length) await tx.insert(kpiDrivers).values(rows);
    });
    n += rows.length;
  }
  return n;
}

export const kpiDriversDim: Dimension = {
  name: KPI_DIMENSION,
  description: "Fundamental KPIs that move each stock: candidates from its business model and management's words, each tested on every results release of 3 years (confirms / invalidates, 5-day price reaction), then strong / weak / none and whether it turns now.",
  sources: [kpiSource],
  subjects: analysedSymbols,
  promote: async (db, fetches): Promise<PromoteResult> => ({ silverRowsBySource: { claude: await promoteKpis(db, fetches) } }),
};

export async function kpiDriversOf(db: Db, symbol: string) {
  return db.select().from(kpiDrivers).where(eq(kpiDrivers.symbol, symbol)).orderBy(asc(kpiDrivers.rank));
}
