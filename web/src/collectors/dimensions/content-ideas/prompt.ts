import { IDEA_SOURCE_KINDS, type IdeaSourceKind, type IdeaSourceRef } from "@/db/schema/content";
import { DRAFT_FORMATS, FORMAT_LABEL, PROPOSED_FORMATS, stripDashes } from "../content-drafts/format";

/** Pure prompts and parsers of the Ideas dimension (proposal, then score per channel x format). */

export const IDEAS_PROMPT_VERSION = "ideas-v2";
export const SCORES_PROMPT_VERSION = "idea-scores-v2";
export const MIN_IDEAS = 3;
export const MAX_IDEAS = 10;

/** One thing an Idea may rest on, offered to the model with its id (`<kind>:<id>`). */
export type Offered = { ref: string; kind: IdeaSourceKind; symbol: string | null; label: string; detail: string };

/** A ticker as the Ideas see it: the analysis objects in words, plus what may be cited. */
export type TickerBrief = { symbol: string; name: string | null; inPortfolio: boolean; position: string; offered: Offered[] };

/** One past publication, any channel. */
export type PastPost = { format: string; title: string; tickers: string[]; publishedAt: string };

const GAME = [
  "You plan what an independent equity research writer publishes next (Thierry Matin, Dualis Research: small and mid caps, long/short).",
  "The game: grow paid Substack subscribers. A reader follows a writer who tells them, early and with evidence, where the market's story on a stock is wrong or turning, in plain words with numbers.",
  "An Idea is ONE thing worth one post: a claim a reader can check, tied to the evidence below. Never an idea the evidence does not support; never a price target, upside or rating.",
  "An Idea does not have to be an inflection or a crack: an interesting update on the company (a result, a filing, a figure that moved) is a good post too.",
  "Fresh beats repeated: a topic already published in the last 14 days comes back only with a new fact. A Signal Change, a strong piece of evidence or a fair value far from the price is worth more than a quiet driver.",
  "No em dash or en dash, no emojis, no hype words.",
].join("\n");

export function ideasSystem(): string {
  return [
    GAME,
    "",
    `Propose ${MIN_IDEAS} to ${MAX_IDEAS} Ideas, best first. Each: "symbol" (the ticker it is about, or null when it spans tickers), "title" (ONE plain sentence, subject verb complement, the claim itself), "angle" (one or two sentences: why it is worth a post now, with the figure or fact), "sources" (1 to 4 ids from the offered list, exactly as written).`,
    'Answer with JSON only, no prose, no code fence: {"ideas": [{"symbol": "...", "title": "...", "angle": "...", "sources": ["..."]}]}',
  ].join("\n");
}

export function ideasPrompt(tickers: TickerBrief[], history: PastPost[], today: string): string {
  const lines = [`Today: ${today}`, "", "What we know, per ticker (each line starts with the id you may cite):"];
  for (const t of tickers) {
    lines.push("", `## ${t.symbol}${t.name ? ` (${t.name})` : ""}${t.inPortfolio ? `, in Thierry's portfolio (${t.position})` : ""}`);
    for (const o of t.offered) lines.push(`- [${o.ref}] ${o.detail}`);
  }
  lines.push("", "Published already (newest first):");
  if (history.length === 0) lines.push("- nothing yet");
  for (const p of history) lines.push(`- ${p.publishedAt.slice(0, 10)} ${FORMAT_LABEL[p.format] ?? p.format}${p.tickers.length ? ` [${p.tickers.join(", ")}]` : ""}: ${p.title}`);
  return lines.join("\n");
}

export type ParsedIdea = { symbol: string | null; title: string; angle: string; sources: IdeaSourceRef[] };

function jsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("answer holds no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * Reads the proposal. Unknown source ids are dropped; an Idea left with no source, an unknown ticker or an empty
 * title is dropped. Throws when fewer than MIN_IDEAS remain (the fetch fails, the next run asks again).
 */
export function parseIdeas(text: string, offered: Offered[], symbols: string[]): ParsedIdea[] {
  const raw = jsonObject(text).ideas;
  if (!Array.isArray(raw)) throw new Error('answer has no "ideas" list');
  const byRef = new Map(offered.map((o) => [o.ref, o]));
  const out: ParsedIdea[] = [];
  for (const r of raw.slice(0, MAX_IDEAS) as Record<string, unknown>[]) {
    const symbol = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : null;
    if (symbol && !symbols.includes(symbol)) continue;
    if (typeof r.title !== "string" || !r.title.trim() || typeof r.angle !== "string" || !r.angle.trim()) continue;
    const refs = Array.isArray(r.sources) ? (r.sources as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const sources = [...new Set(refs.map((x) => x.trim()))]
      .map((ref) => byRef.get(ref))
      .filter((o): o is Offered => !!o)
      .map((o) => ({ kind: o.kind, ref: o.ref, symbol: o.symbol, label: o.label }));
    if (sources.length === 0) continue;
    out.push({ symbol, title: stripDashes(r.title.trim()), angle: stripDashes(r.angle.trim()), sources });
  }
  if (out.length < MIN_IDEAS) throw new Error(`only ${out.length} usable ideas (need ${MIN_IDEAS}): each needs a known ticker, a title, an angle and an offered source`);
  return out;
}

const FORMAT_FIT: Record<string, string> = {
  "x-post": "X post: one sharp dated fact with its chart, 160 characters. Reaches new readers fast.",
  "substack-note": "Substack Note: one small paragraph with a chart, inside Substack, where subscribers and recommenders already are. Best for a quick update or one striking figure.",
  "linkedin-post": "LinkedIn post: a professional audience (allocators, analysts). Fits a clear lesson or a well-argued call.",
};

export function scoresSystem(): string {
  return [
    GAME,
    "",
    "Score how well each Idea fits each channel x format, 0 to 100 (100 = publish it there today). Weigh: what the format needs (depth, a chart, one fact), what that channel already got recently (no repeat, no gap of weeks), and how much the idea can grow subscribers there.",
    "Formats:",
    ...PROPOSED_FORMATS.map((f) => `- ${f}: ${FORMAT_FIT[f]}`),
    "",
    'Score EVERY idea on EVERY format. Answer with JSON only, no prose, no code fence: {"scores": [{"idea": <number>, "format": "<format>", "score": <0-100>, "why": "<one short sentence>"}]}',
  ].join("\n");
}

export function scoresPrompt(ideas: { title: string; angle: string; symbol: string | null }[], history: PastPost[], today: string): string {
  const lines = [`Today: ${today}`, "", "Ideas:"];
  ideas.forEach((i, n) => lines.push(`${n + 1}. ${i.symbol ? `[${i.symbol}] ` : ""}${i.title} Why now: ${i.angle}`));
  // Every format he published counts, his own articles included: a Note can tease the week's article.
  lines.push("", "Published already, per format (newest first):");
  for (const f of DRAFT_FORMATS) {
    const past = history.filter((p) => p.format === f).slice(0, 5);
    lines.push(`- ${f}: ${past.length ? past.map((p) => `${p.publishedAt.slice(0, 10)} ${p.title}`).join(" | ") : "nothing yet"}`);
  }
  return lines.join("\n");
}

export type ParsedScore = { idea: number; format: string; score: number; why: string };

/** Reads the scores; throws unless every (idea, format) pair has exactly one score in 0..100. */
export function parseScores(text: string, ideaCount: number): ParsedScore[] {
  const raw = jsonObject(text).scores;
  if (!Array.isArray(raw)) throw new Error('answer has no "scores" list');
  const out = new Map<string, ParsedScore>();
  for (const r of raw as Record<string, unknown>[]) {
    const idea = Number(r.idea);
    const format = String(r.format);
    const score = Math.round(Number(r.score));
    if (!Number.isInteger(idea) || idea < 1 || idea > ideaCount) continue;
    if (!(PROPOSED_FORMATS as readonly string[]).includes(format)) continue;
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;
    out.set(`${idea}|${format}`, { idea, format, score, why: stripDashes(String(r.why ?? "").trim()) });
  }
  const missing: string[] = [];
  for (let i = 1; i <= ideaCount; i++) for (const f of PROPOSED_FORMATS) if (!out.has(`${i}|${f}`)) missing.push(`${i}/${f}`);
  if (missing.length) throw new Error(`no score for ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
  return [...out.values()];
}

export function isSourceKind(k: string): k is IdeaSourceKind {
  return (IDEA_SOURCE_KINDS as readonly string[]).includes(k);
}
