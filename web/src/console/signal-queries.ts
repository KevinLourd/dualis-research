import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { goldCatalysts, thesisConfidence, thesisTransitions } from "@/db/schema/catalysts";
import { theses } from "@/db/schema/thesis";

/** Console reads behind the signal: current states (Tickers list) and one ticker's "why" (Analysis page). Gold only. */

/** Current state per ticker (Tickers list). */
export async function signalStates() {
  return getDb().select({ symbol: thesisConfidence.symbol, state: thesisConfidence.state, since: thesisConfidence.since }).from(thesisConfidence);
}

/** One ticker's why: the narrative and the view, Thierry's fair value, the current state, the latest signal, every judged item. */
export async function getWhy(symbol: string) {
  const db = getDb();
  const [[thesis], [state], [latest], evidence] = await Promise.all([
    db.select().from(theses).where(eq(theses.symbol, symbol)),
    db.select().from(thesisConfidence).where(eq(thesisConfidence.symbol, symbol)),
    db.select().from(thesisTransitions).where(eq(thesisTransitions.symbol, symbol)).orderBy(desc(thesisTransitions.at)).limit(1),
    db.select().from(goldCatalysts).where(eq(goldCatalysts.symbol, symbol)).orderBy(desc(goldCatalysts.eventAt)).limit(30),
  ]);
  return { thesis: thesis ?? null, state: state ?? null, latest: latest ?? null, evidence };
}
