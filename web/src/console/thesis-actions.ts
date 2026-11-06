"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { pickWinner } from "@/bsg/provenance";
import { recordConsoleEdit } from "@/collectors/dimensions/thesis/console";
import { type FairValue, THESIS_DIMENSION } from "@/collectors/dimensions/thesis/gold";
import { THESIS_MANUAL, THESIS_PRIORITY } from "@/collectors/dimensions/thesis/sources";
import { facts } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { withWriteDb } from "@/db/write";

/**
 * Thierry's inline edits on the ticker page: the market's narrative, his view (`summary`), his fair value.
 * Every save is a new authored version (bronze source "console"), promoted at once: Thierry's word wins in gold,
 * the earlier text stays in silver. Saving the prefilled text unchanged = he accepts it (one fact, both tags).
 */

const TEXT_FIELDS = ["narrative", "summary"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

async function current(db: Db, symbol: string, field: string) {
  const candidates = await db.select().from(facts).where(and(eq(facts.dimension, THESIS_DIMENSION), eq(facts.subject, symbol), eq(facts.field, field)));
  return pickWinner(candidates, { priority: THESIS_PRIORITY, manual: THESIS_MANUAL });
}

/** House style: no em or en dash in what we show. */
const clean = (s: string) => s.replace(/\s*[—–]\s*/g, ", ").trim();

export async function saveText(symbol: string, field: TextField, text: string): Promise<void> {
  if (!symbol || !TEXT_FIELDS.includes(field)) throw new Error(`invalid field "${field}" for "${symbol}"`);
  const value = clean(text);
  if (!value) throw new Error("The text is empty");
  const { userId } = await auth();
  await withWriteDb(async (db) => {
    const active = await current(db, symbol, field);
    if (active?.value === value && active.sources.some((s) => (THESIS_MANUAL as readonly string[]).includes(s))) return; // already his word
    await recordConsoleEdit(db, symbol, { field, value, action: "edit", userId });
  });
  revalidatePath(`/tickers/${encodeURIComponent(symbol)}`, "layout");
}

/** Thierry's fundamental value per share (his number only, never Claude's): a positive amount + how he got it. */
export async function saveFairValue(symbol: string, currency: string | null, formData: FormData): Promise<void> {
  const value = Number(String(formData.get("value") ?? "").replace(/[^0-9.]/g, ""));
  if (!(value > 0)) throw new Error("The fair value must be a positive number");
  const basis = clean(String(formData.get("basis") ?? "")) || null;
  const { userId } = await auth();
  const fair: FairValue = { value, currency, basis };
  await withWriteDb((db) => recordConsoleEdit(db, symbol, { field: "fairValue", value: fair, action: "edit", userId }));
  revalidatePath(`/tickers/${encodeURIComponent(symbol)}`, "layout");
}
