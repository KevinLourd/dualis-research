import { and, desc, eq } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { evidence, fairValues, narrativeStates, signalChanges, signalStates, signals, type GoldNarrativeState, type SignalKind, type Strength, type ThesisReading, type ThesisSide } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { majorUnit } from "../financials/derive";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";
import { SIDE } from "../analysis/sides";

export const SIGNALS_DIMENSION = "signals";
/** Evidence ids kept on a signal (its strongest reversals). */
const MAX_EVIDENCE = 10;

export type SignalReading = {
  signal: SignalKind;
  strength: Strength;
  side: ThesisSide | null;
  why: string | null;
  theses: ThesisReading[];
  evidenceIds: string[];
  fairValue: number | null;
  fairValueMethod: string | null;
  fairValueLabel?: string | null;
  currency: string | null;
  quote: number | null;
  quoteDate: string | null;
  gapPct: number | null;
};

type ThesisState = Pick<GoldNarrativeState, "side" | "effect" | "strength" | "signal" | "why" | "since" | "evidenceIds">;

/**
 * The surfacing rule (Kevin 2026-11-09): each thesis' judge already decided whether it signals now (narrative-state,
 * level `thesis`). One thesis (price outside the fair value range): its signal. Two (inside the range, in competition):
 * the one that signals ALONE surfaces; both signalling, or neither, = no signal. A long signals a BUY, a short a SELL.
 */
export function combineTheses(states: ThesisState[]): { signal: SignalKind; strength: Strength; side: ThesisSide | null; why: string | null; evidenceIds: string[] } {
  const signalling = states.filter((s) => s.signal === "strong" || s.signal === "weak");
  if (signalling.length !== 1) {
    const why = signalling.length > 1 ? "Both the long and the short thesis signal: the two stories cancel out." : (states.length === 1 ? states[0].why : null);
    return { signal: "none", strength: "noise", side: null, why, evidenceIds: [] };
  }
  const s = signalling[0];
  return { signal: SIDE[s.side].signal, strength: s.signal as Strength, side: s.side, why: s.why, evidenceIds: s.evidenceIds.slice(0, MAX_EVIDENCE) };
}

export function readingOf(
  fv: { value: number; currency: string | null; method: string | null; label?: string | null } | null,
  quote: { close: number; currency: string | null; date: string } | null,
  states: ThesisState[],
): SignalReading {
  const q = quote ? majorUnit(quote.close, quote.currency) : null;
  const comparable = !!fv && !!q && (!fv.currency || !q.currency || fv.currency === q.currency);
  const gapPct = comparable && fv!.value > 0 ? q!.price / fv!.value - 1 : null;
  const theses: ThesisReading[] = states.map((s) => ({ side: s.side, signal: s.signal ?? "noise", effect: s.effect, strength: s.strength, why: s.why, since: s.since }));
  return { ...combineTheses(states), theses, fairValue: fv?.value ?? null, fairValueMethod: fv?.method ?? null, fairValueLabel: fv?.label ?? null, currency: fv?.currency ?? null, quote: q?.price ?? null, quoteDate: quote?.date ?? null, gapPct };
}

export const rulesSource: Source = {
  name: "rules",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("signals: needs the database");
    const [fv] = await ctx.db.select().from(fairValues).where(eq(fairValues.symbol, symbol));
    const [quote] = await ctx.db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol));
    const states = await ctx.db.select().from(narrativeStates).where(and(eq(narrativeStates.symbol, symbol), eq(narrativeStates.level, "thesis")));
    const reading = readingOf(fv ?? null, quote ? { close: quote.close, currency: quote.currency, date: quote.date } : null, states);
    return { request: { symbol, rule: "the thesis that signals alone surfaces; both or neither = none", theses: states.map((s) => `${s.side} ${s.signal ?? "noise"}`) }, httpStatus: null, payload: reading };
  },
};

export const signalsDim: Dimension = {
  name: SIGNALS_DIMENSION,
  description: "Signal per ticker from its theses' judged signals: one thesis = its signal; two in competition = the one that signals alone, else none. Each change after the first reading = a Signal Change with an Update Note.",
  sources: [rulesSource],
  subjects: analysedSymbols,
  promote: (db, fetches, ctx) => promoteSignals(db, fetches, ctx.complete),
};

const sameState = (a: { signal: string; strength: string }, b: { signal: string; strength: string }) => a.signal === b.signal && a.strength === b.strength;

/** Bump when the Update Note prompt changes: every past note is written again once (Kevin 2026-11-06: one sentence). */
export const NOTE_VERSION = "note@v2";

/** "BUY (weak inflection)": a BUY is a bad story inflecting, a SELL a loved one cracking. */
export const signalWords = (signal: string, strength: string) =>
  signal === "none" ? "no signal" : `${signal} (${strength} ${signal === "BUY" ? "inflection" : "crack"})`;

export const NOTE_SYSTEM = "You write one-line signal notes for a small-cap long/short analyst. Plain English, subject verb complement, one sentence, at most 20 words. No em dash.";

async function updateNote(db: Db, complete: Complete, symbol: string, from: { signal: string; strength: string }, to: { signal: string; strength: string; evidenceIds: string[] }): Promise<{ text: string; model: string }> {
  const items = to.evidenceIds.length ? (await db.select().from(evidence).where(eq(evidence.symbol, symbol))).filter((e) => to.evidenceIds.includes(e.id)) : [];
  const [[profile], states] = await Promise.all([
    db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol)),
    db.select().from(narrativeStates).where(and(eq(narrativeStates.symbol, symbol), eq(narrativeStates.level, "thesis"))),
  ]);
  const state = states.find((s) => s.side === (to.signal === "SELL" ? "short" : "long")) ?? states[0];
  const prompt = [
    `${profile?.name ?? symbol} (${symbol}): the signal moved from ${signalWords(from.signal, from.strength)} to ${signalWords(to.signal, to.strength)}.`,
    state?.why ? `Where the narrative stands: ${state.why}` : null,
    "The news behind it:",
    ...(items.length ? items.slice(0, 5).map((e) => `- ${e.eventDay}: ${e.headline}`) : ["- none"]),
    "",
    "Write the note: ONE short sentence saying what moved the signal, e.g. \"Q3 beat eases the doubt on the 2026 guide.\" No figures from the fair value, no calculation, no rating, no horizon.",
  ]
    .filter((x) => x !== null)
    .join("\n");
  const r = await complete({ system: NOTE_SYSTEM, prompt });
  return { text: stripDashes(r.text.trim()), model: r.model };
}

/**
 * silver.signal_states: a new row only when a ticker's signal or strength changes; its first row is the baseline
 * (no Signal Change, no note). gold.signals = current state; gold.signal_changes = every later change with its note.
 */
export async function promoteSignals(db: Db, fetches: BronzeFetch[], complete: Complete | undefined, now = new Date()): Promise<PromoteResult> {
  const latest = new Map<string, BronzeFetch>();
  for (const f of fetches.filter((x) => !x.error).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) latest.set(f.subject, f);
  let changes = 0;
  for (const [symbol, f] of latest) {
    const reading = f.payload as SignalReading;
    const [last] = await db.select().from(signalStates).where(eq(signalStates.symbol, symbol)).orderBy(desc(signalStates.at)).limit(1);
    if (last && sameState(last, reading)) continue;
    let note: { text: string; model: string } | null = null;
    if (last) {
      if (!complete) throw new Error("signals: a Signal Change needs the LLM for its Update Note (cli.ts sets ctx.complete)");
      note = await updateNote(db, complete, symbol, last, reading);
      changes++;
    }
    await db.insert(signalStates).values({ symbol, signal: reading.signal, strength: reading.strength, evidenceIds: reading.evidenceIds, gapPct: reading.gapPct, at: now, baseline: last ? 0 : 1, updateNote: note?.text ?? null, model: note?.model ?? null, noteVersion: note ? NOTE_VERSION : null });
  }
  // Notes written by an older prompt are written again once, against the state they came from.
  const history = await db.select().from(signalStates).orderBy(signalStates.symbol, signalStates.at);
  for (let i = 1; i < history.length; i++) {
    const [a, b] = [history[i - 1], history[i]];
    if (a.symbol !== b.symbol || b.baseline === 1 || b.noteVersion === NOTE_VERSION) continue;
    if (!complete) throw new Error("signals: rewriting an Update Note needs the LLM (cli.ts sets ctx.complete)");
    const note = await updateNote(db, complete, b.symbol, a, b);
    await db.update(signalStates).set({ updateNote: note.text, model: note.model, noteVersion: NOTE_VERSION }).where(eq(signalStates.id, b.id));
  }
  await rebuildSignalsGold(db, latest);
  return { silverRowsBySource: { rules: changes } };
}

async function rebuildSignalsGold(db: Db, latest: Map<string, BronzeFetch>): Promise<void> {
  const states = await db.select().from(signalStates).orderBy(signalStates.at);
  const bySymbol = new Map<string, (typeof states)[number][]>();
  for (const s of states) bySymbol.set(s.symbol, [...(bySymbol.get(s.symbol) ?? []), s]);
  const current: (typeof signals.$inferInsert)[] = [];
  const changes: (typeof signalChanges.$inferInsert)[] = [];
  for (const [symbol, list] of bySymbol) {
    const f = latest.get(symbol);
    const last = list.at(-1)!;
    if (f) {
      const r = f.payload as SignalReading;
      current.push({ symbol, signal: r.signal, strength: r.strength, side: r.side, why: r.why, theses: r.theses, fairValue: r.fairValue, fairValueMethod: r.fairValueMethod, fairValueLabel: r.fairValueLabel ?? null, currency: r.currency, quote: r.quote, quoteDate: r.quoteDate, gapPct: r.gapPct, evidenceIds: r.evidenceIds, since: last.at });
    }
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      changes.push({ id: b.id, symbol, fromSignal: a.signal, toSignal: b.signal, fromStrength: a.strength, toStrength: b.strength, at: b.at, updateNote: b.updateNote, evidenceIds: b.evidenceIds });
    }
  }
  await db.transaction(async (tx) => {
    if (current.length) {
      await tx.delete(signals);
      await tx.insert(signals).values(current);
    }
    await tx.delete(signalChanges);
    if (changes.length) await tx.insert(signalChanges).values(changes);
  });
}

