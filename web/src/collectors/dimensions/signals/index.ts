import { and, desc, eq } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { evidence, fairValues, narrativeStates, signalChanges, signalStates, signals, type GoldNarrativeState, type SignalKind, type Strength } from "@/db/schema/analysis";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import type { Dimension, FetchOutcome, PromoteResult, Source, SourceContext } from "../../types";
import { majorUnit } from "../financials/derive";
import { stripDashes } from "../thesis/structure";
import { analysedSymbols } from "../watchlist";

export const SIGNALS_DIMENSION = "signals";
/** Evidence ids kept on a signal (its strongest reversals). */
const MAX_EVIDENCE = 10;

export type SignalReading = { signal: SignalKind; strength: Strength; evidenceIds: string[]; fairValue: number | null; fairValueMethod: string | null; fairValueLabel?: string | null; currency: string | null; quote: number | null; quoteDate: string | null; gapPct: number | null };

/**
 * The rule (Thierry's method, Kevin 2026-11-06): the whole narrative in REVERSAL (its ticker-level Narrative State) with
 * the price BELOW fair value = BUY (a bad story inflects); in reversal with the price ABOVE = SELL (a loved story
 * cracks); continuation or noise = none. Strength = the state's strength.
 */
export function computeSignal(
  fv: { value: number; currency: string | null; method: string | null; label?: string | null } | null,
  quote: { close: number; currency: string | null; date: string } | null,
  state: Pick<GoldNarrativeState, "effect" | "strength" | "evidenceIds"> | null,
): SignalReading {
  const q = quote ? majorUnit(quote.close, quote.currency) : null;
  const comparable = !!fv && !!q && (!fv.currency || !q.currency || fv.currency === q.currency);
  const gapPct = comparable && fv!.value > 0 ? q!.price / fv!.value - 1 : null;
  const base = { fairValue: fv?.value ?? null, fairValueMethod: fv?.method ?? null, fairValueLabel: fv?.label ?? null, currency: fv?.currency ?? null, quote: q?.price ?? null, quoteDate: quote?.date ?? null, gapPct };
  if (gapPct === null || gapPct === 0 || !state || state.effect !== "reversal") return { ...base, signal: "none", strength: "noise", evidenceIds: [] };
  return { ...base, signal: gapPct < 0 ? "BUY" : "SELL", strength: state.strength, evidenceIds: state.evidenceIds.slice(0, MAX_EVIDENCE) };
}

export const rulesSource: Source = {
  name: "rules",
  requiredEnv: [],
  covers: () => true,
  async fetch(symbol: string, ctx: SourceContext): Promise<FetchOutcome> {
    if (!ctx.db) throw new Error("signals: needs the database");
    const [fv] = await ctx.db.select().from(fairValues).where(eq(fairValues.symbol, symbol));
    const [quote] = await ctx.db.select().from(gold.quotes).where(eq(gold.quotes.symbol, symbol));
    const [state] = await ctx.db.select().from(narrativeStates).where(and(eq(narrativeStates.symbol, symbol), eq(narrativeStates.level, "ticker")));
    const reading = computeSignal(fv ?? null, quote ? { close: quote.close, currency: quote.currency, date: quote.date } : null, state ?? null);
    return { request: { symbol, rule: "BUY/SELL = the narrative in reversal, below / above fair value", state: state ? `${state.effect}:${state.strength}` : null }, httpStatus: null, payload: reading };
  },
};

export const signalsDim: Dimension = {
  name: SIGNALS_DIMENSION,
  description: "Signal per ticker: BUY (the narrative in reversal, price below fair value) / SELL (in reversal, price above) / none, its strength = the narrative's. Each change after the first reading = a Signal Change with an Update Note.",
  sources: [rulesSource],
  subjects: analysedSymbols,
  promote: (db, fetches, ctx) => promoteSignals(db, fetches, ctx.complete),
};

const sameState = (a: { signal: string; strength: string }, b: { signal: string; strength: string }) => a.signal === b.signal && a.strength === b.strength;

async function updateNote(db: Db, complete: Complete, symbol: string, from: { signal: string; strength: string }, to: SignalReading): Promise<{ text: string; model: string }> {
  const items = to.evidenceIds.length ? (await db.select().from(evidence).where(eq(evidence.symbol, symbol))).filter((e) => to.evidenceIds.includes(e.id)) : [];
  const [profile] = await db.select({ name: gold.companyProfiles.name }).from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, symbol));
  const prompt = [
    `${profile?.name ?? symbol} (${symbol}): the signal moved from ${from.signal} (${from.strength}) to ${to.signal} (${to.strength}).`,
    `Fair value ${to.fairValue ?? "n/a"} ${to.currency ?? ""} (${to.fairValueMethod ?? "no method"}); quote ${to.quote ?? "n/a"} on ${to.quoteDate ?? "n/a"}.`,
    "The evidence behind it:",
    ...(items.length ? items.map((e) => `- ${e.eventDay}: ${e.headline} (${e.effect}, ${e.strength}). ${e.why ?? ""}`) : ["- no reversal in the news"]),
    "",
    "Write the Update Note: 2 to 4 plain sentences for the analyst, what changed and why, the figures as given. No rating, no % upside, no horizon. No em dash.",
  ].join("\n");
  const r = await complete({ system: "You write short research update notes for a small-cap long/short analyst. Plain English, figures only as given.", prompt });
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
    await db.insert(signalStates).values({ symbol, signal: reading.signal, strength: reading.strength, evidenceIds: reading.evidenceIds, gapPct: reading.gapPct, at: now, baseline: last ? 0 : 1, updateNote: note?.text ?? null, model: note?.model ?? null });
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
      current.push({ symbol, signal: r.signal, strength: r.strength, fairValue: r.fairValue, fairValueMethod: r.fairValueMethod, fairValueLabel: r.fairValueLabel ?? null, currency: r.currency, quote: r.quote, quoteDate: r.quoteDate, gapPct: r.gapPct, evidenceIds: r.evidenceIds, since: last.at });
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

