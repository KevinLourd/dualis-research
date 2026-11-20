import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { KPI_LEVELS, KPI_VERDICTS, kpiDrivers, type DocCitation, type KpiLevel, type KpiRelease, type KpiTestRow, type KpiVerdict } from "@/db/schema/analysis";
import { documentPages, documents } from "@/db/schema/documents";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
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
/** v5 (Kevin 2026-11-19): two tests per KPI, B1 on every release and news item, B2 on any other filing where the KPI moved. */
export const TEST_QUESTION = "kpi-test@v5";
/** Pages of each report a judge reads (the results discussion first) and how much of each page. */
const PAGES_PER_RELEASE = 2;
const PAGE_CHARS = 3_500;
const DAY = 86_400_000;

type Release = KpiRelease & { pages: { page: number; text: string }[] };
/** A dated moment a KPI may have moved at: a results release (its pages), a news item or another filing (its title). */
export type KpiEvent = { label: string; kind: "release" | "news" | "filing"; id: string; day: string; title: string; text: string | null; stock: number | null; bench: number | null; reaction: number | null; unusual: number | null; pages: { page: number; text: string }[] };
export type KpiCandidate = { name: string; why: string; series: string | null; approximation: string | null };
type Test = { level: KpiLevel; reason: string; rows: KpiTestRow[]; signal: KpiLevel | null; signalWhy: string | null; direction: "up" | "down" | null };

const signedPct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

/** The return from the last close before `day` to the close `n` trading days later, from daily closes (oldest first). */
export function reactionAfter(bars: { date: string; close: number }[], day: string, n = REACTION_DAYS): number | null {
  const i = bars.findIndex((b) => b.date >= day);
  if (i <= 0 || i + n - 1 >= bars.length) return null;
  return bars[i + n - 1].close / bars[i - 1].close - 1;
}

/**
 * How unusual a 5-day move against the S&P 500 is for this stock: the move over the standard deviation of its own
 * 5-day moves (against the S&P 500) over the year before the day. Null with less than 60 such moves.
 */
export function unusualness(stock: { date: string; close: number }[], bench: { date: string; close: number }[], day: string, reaction: number | null): number | null {
  if (reaction === null) return null;
  const b = new Map(bench.map((x) => [x.date, x.close]));
  const i = stock.findIndex((x) => x.date >= day);
  if (i <= 0) return null;
  const moves: number[] = [];
  for (let j = Math.max(REACTION_DAYS, i - 250); j < i; j++) {
    const s0 = stock[j - REACTION_DAYS].close;
    const s1 = stock[j].close;
    const b0 = b.get(stock[j - REACTION_DAYS].date);
    const b1 = b.get(stock[j].date);
    moves.push(s1 / s0 - 1 - (b0 && b1 ? b1 / b0 - 1 : 0));
  }
  if (moves.length < 60) return null;
  const mean = moves.reduce((a, x) => a + x, 0) / moves.length;
  const sd = Math.sqrt(moves.reduce((a, x) => a + (x - mean) ** 2, 0) / moves.length);
  return sd > 0 ? reaction / sd : null;
}

/** Every release, news item and other filing of the last 3 years, oldest first, each with its 5-day reaction. */
export async function eventsOf(db: Db, symbol: string, now = new Date()): Promise<KpiEvent[]> {
  const since = new Date(now.getTime() - KPI_YEARS * 365.25 * DAY);
  const [releases, news, filed, stock, bench] = await Promise.all([
    releasesOf(db, symbol, now),
    db
      .select({ id: goldNewsItems.id, title: goldNewsItems.title, summary: goldNewsItems.summary, publishedAt: goldNewsItems.publishedAt, firstSeenAt: goldNewsItems.firstSeenAt })
      .from(goldNewsLinks)
      .innerJoin(goldNewsItems, eq(goldNewsItems.id, goldNewsLinks.newsItemId))
      .where(and(eq(goldNewsLinks.symbol, symbol), gte(goldNewsLinks.firstSeenAt, since))),
    db.select().from(gold.filings).where(and(eq(gold.filings.symbol, symbol), gte(gold.filings.filedAt, since))),
    db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(eq(gold.priceBars.symbol, symbol)).orderBy(asc(gold.priceBars.date)),
    db.select({ date: gold.priceBars.date, close: gold.priceBars.close }).from(gold.priceBars).where(eq(gold.priceBars.symbol, "^GSPC")).orderBy(asc(gold.priceBars.date)),
  ]);
  const at = (day: string) => {
    const s = reactionAfter(stock, day);
    const b = reactionAfter(bench, day);
    const reaction = s === null ? null : s - (b ?? 0);
    return { stock: s, bench: b, reaction, unusual: unusualness(stock, bench, day, reaction) };
  };
  const reports = new Set(releases.map((r) => r.id));
  const raw = [
    ...releases.map((r) => ({ kind: "release" as const, id: r.id, day: r.day, title: r.title, text: null, pages: r.pages })),
    ...news.map((n) => ({ kind: "news" as const, id: String(n.id), day: (n.publishedAt ?? n.firstSeenAt).toISOString().slice(0, 10), title: n.title, text: n.summary ? n.summary.replace(/\s+/g, " ").slice(0, 300) : null, pages: [] })),
    ...filed.filter((f) => !reports.has(f.id)).map((f) => ({ kind: "filing" as const, id: f.id, day: f.filedAt.toISOString().slice(0, 10), title: f.form ? `${f.form}: ${f.title}` : f.title, text: null, pages: [] })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const prefix = { release: "R", news: "N", filing: "F" } as const;
  const n = { release: 0, news: 0, filing: 0 };
  return raw.map((e) => ({ ...e, label: `${prefix[e.kind]}${++n[e.kind]}`, ...at(e.day) }));
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
  let r = await complete({ system, prompt });
  let parsed: T;
  try {
    parsed = await parse(r.text);
  } catch (err) {
    // One repair ask, like the analysis (Worldex 2026-11-20: a 3-year answer came back as unreadable JSON); a second
    // failure is loud, with the answer's size and end so the cause shows (cut off, or an unescaped quote).
    const first = (err as Error).message;
    r = await complete({ system, prompt: `${prompt}\n\nYour previous answer could not be read (${first.slice(0, 200)}). Answer again with valid JSON only: escape every double quote inside a string, keep each why short.` });
    try {
      parsed = await parse(r.text);
    } catch (again) {
      throw new Error(`${(again as Error).message.slice(0, 200)} (answer ${r.text.length} chars, ends: ${JSON.stringify(r.text.slice(-120))})`);
    }
  }
  await db.insert(silver.judgments).values({ subjectKind: kind, subjectId, questionKey: key, question, verdict: "answered", probability: 1, citedSentence: null, reason: null, model: r.model, raw: { text: r.text } }).onConflictDoNothing();
  return parsed;
}

const eventLine = (e: KpiEvent) =>
  `${e.label} ${e.day} ${e.kind === "release" ? "results release" : e.kind}: ${e.title}${e.text ? `. ${e.text}` : ""}. Price ${signedPct(e.stock)} over the next ${REACTION_DAYS} trading days, S&P 500 ${signedPct(e.bench)}, so ${signedPct(e.reaction)} against the market${e.unusual === null ? "" : ` (${Math.abs(e.unusual).toFixed(1)} standard deviations of its usual 5-day moves)`}.`;
const eventsText = (es: KpiEvent[]) => es.map((e) => [eventLine(e), ...e.pages.map((p) => `  [${e.label} page ${p.page}]\n${p.text}`)].join("\n")).join("\n\n");

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
  "You test ONE hypothesis for a small-cap long/short analyst: « this fundamental KPI of the company moves this stock ». Like a scientist, in two tests.",
  "Every dated moment of 3 years is listed: results releases (R, with the report's pages), news items (N) and the company's other filings (F), each with the price over the 5 trading days after against the S&P 500 and how unusual that move is for this stock.",
  "B1, on EVERY release and news item: bigMove = did the price move a lot in those 5 days (judge from the move and how unusual it is)? kpiChanged = did THIS KPI change significantly at that moment (from the figures given, the report's words and tables, the news)? verdict: confirms = the KPI changed and the price moved the way that change implies; invalidates = the KPI changed strongly and the price did not react, or moved the other way; neutral = the KPI did not change, or something else clearly moved the price.",
  "B2, the rest of the time: among the other filings (F), every one where THIS KPI moved strongly (a disclosure of a large change in sales or profit, an order, a capacity or customer event...): did the price move with it? Same verdicts. List only those filings.",
  "from / to / change = the KPI values at that moment (with units), null when not shown or when it did not change. why = at most 12 words, the fact. cite = the release label, page and an EXACT quote of the report, only for releases, null otherwise.",
  "level: decide it yourself, as the analyst would, from B1 and B2: never by counting. Weigh each moment: how big the KPI move was, how clear the price reaction was, whether another fact or the market at large explains it, whether the evidence is recent. A small cap's price is noisy: one contrary moment can be noise, a clean, large KPI move the price ignored says much more. strong = the market clearly trades the stock on this KPI; weak = it does sometimes, or the evidence is thin; none = it does not.",
  "reason = ONE plain sentence, at most 15 words, that a reader landing on the page understands at once: the conclusion about how the stock reacts to this KPI. No dates, no list of figures, no labels.",
  "signal (only when level is strong or weak, else null): does the KPI turn NOW, at the latest moment, by enough to change the story, with the price not reacting yet? strong (only for a strong KPI) / weak / none. signalWhy = one sentence with the figure. direction = up or down, the way the KPI moved last.",
  "No em dash. JSON only, no prose, no code fence:",
  '{"b1": [{"event": "R1" | "N1", "bigMove": boolean, "kpiChanged": boolean, "verdict": "confirms" | "invalidates" | "neutral", "from": string | null, "to": string | null, "change": string | null, "why": string, "cite": {"release": "R1", "page": 12, "quote": "<exact words>"} | null}], "b2": [{"event": "F3", "bigMove": boolean, "verdict": "confirms" | "invalidates" | "neutral", "from": string | null, "to": string | null, "change": string | null, "why": string}], "level": "strong" | "weak" | "none", "reason": string, "signal": "strong" | "weak" | "none" | null, "signalWhy": string | null, "direction": "up" | "down" | null}',
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

/** A test answer: one B1 row per release and news item (a missing one = an error), B2 rows for other filings only; quotes kept only when printed on their page. */
export async function parseTest(db: Db, text: string, events: KpiEvent[]): Promise<Test> {
  const obj = JSON.parse(firstJsonObject(text)) as Record<string, unknown>;
  if (!KPI_LEVELS.includes(obj.level as KpiLevel)) throw new Error(`kpi-drivers: level "${String(obj.level)}" is not one of ${KPI_LEVELS.join(", ")}`);
  if (typeof obj.reason !== "string" || !obj.reason.trim()) throw new Error("kpi-drivers: no reason");
  const byLabel = new Map(events.map((e) => [e.label, e]));
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? stripDashes(v.trim()) : null);
  const verdictOf = (x: Record<string, unknown>, label: string) => {
    if (!KPI_VERDICTS.includes(x.verdict as KpiVerdict)) throw new Error(`kpi-drivers: verdict "${String(x.verdict)}" for ${label}`);
    return x.verdict as KpiVerdict;
  };
  const rowOf = (e: KpiEvent, x: Record<string, unknown>, step: "B1" | "B2", cite: DocCitation | null): KpiTestRow => ({
    releaseId: e.id,
    day: e.day,
    title: e.title,
    step,
    kind: e.kind,
    reaction: e.reaction,
    unusual: e.unusual,
    bigMove: x.bigMove === true,
    kpiChanged: step === "B2" ? true : x.kpiChanged === true,
    from: str(x.from),
    to: str(x.to),
    change: str(x.change),
    verdict: verdictOf(x, e.label),
    why: str(x.why) ?? "",
    cite,
  });
  const b1 = new Map((Array.isArray(obj.b1) ? obj.b1 : []).map((r) => [String((r as { event?: unknown }).event), r as Record<string, unknown>]));
  const rows: KpiTestRow[] = [];
  for (const e of events.filter((x) => x.kind !== "filing")) {
    const x = b1.get(e.label);
    if (!x) throw new Error(`kpi-drivers: no B1 row for ${e.label}`);
    let cite: DocCitation | null = null;
    const c = x.cite as { release?: unknown; page?: unknown; quote?: unknown } | null;
    const doc = c ? byLabel.get(String(c.release)) : undefined;
    if (c && doc?.kind === "release" && typeof c.page === "number" && typeof c.quote === "string" && (await verifyQuote(db, doc.id, c.page, c.quote))) cite = { documentId: doc.id, page: c.page, quote: c.quote, title: doc.title, filedAt: doc.day };
    rows.push(rowOf(e, x, "B1", cite));
  }
  for (const r of Array.isArray(obj.b2) ? obj.b2 : []) {
    const x = r as Record<string, unknown>;
    const e = byLabel.get(String(x.event));
    if (!e || e.kind !== "filing" || rows.some((y) => y.releaseId === e.id)) continue;
    rows.push(rowOf(e, x, "B2", null));
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
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
  const events = await eventsOf(db, symbol);
  const releases = events.filter((e) => e.kind === "release");
  const catalog = await seriesCatalog(db, symbol);
  const [profile] = await db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
  const company = `${symbol}${profile?.name ? ` (${profile.name})` : ""}${profile?.industry ? `, ${profile.industry}` : ""}. ${profile?.description ?? ""}`.trim();
  const keys = [...catalog.values()].filter((s) => /^(line|hline|qline|metric|qmetric):/.test(s.key)).map((s) => `${s.label} [${s.key}]`);
  const docKey = fnv(events.map((e) => e.id).join(","));
  const latest = releases.slice(-4);
  const candidates = await once(
    db,
    complete,
    "kpi-candidates",
    symbol,
    `${CANDIDATES_QUESTION}:${docKey}:${fnv(keys.join("|"))}`,
    `${CANDIDATES_QUESTION}: which fundamental KPIs drive ${symbol}?`,
    CANDIDATES_SYSTEM,
    [`Company: ${company}`, "", "Stored series:", keys.join("\n") || "none", "", "Its latest reports (best pages):", eventsText(latest)].join("\n"),
    (text) => parseCandidates(text, catalog),
  );
  const drivers: (KpiCandidate & Test)[] = [];
  for (const k of candidates) {
    const s = k.series ? catalog.get(k.series) : undefined;
    const figures = releases.map((r) => `${r.label}: ${(s && seriesAt(s, r.day)) ?? "no stored figure: read it in the report"}`).join("\n");
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
        `Every dated moment of the last ${KPI_YEARS} years, oldest first:`,
        eventsText(events),
        "",
        `B1 has exactly ${events.filter((e) => e.kind !== "filing").length} rows, one per release and news item (${events.filter((e) => e.kind !== "filing").map((e) => e.label).join(", ")}), none skipped.`,
      ].join("\n"),
      (text) => parseTest(db, text, events),
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
