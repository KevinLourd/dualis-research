"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { recordConsoleEdit } from "@/collectors/dimensions/thesis/console";
import type { FairValue } from "@/collectors/dimensions/thesis/gold";
import { withWriteDb } from "@/db/write";

/**
 * Thierry's fair value on the ticker page (bronze source "console", his word wins in gold). The narrative is never
 * edited by hand since 2026-11-09 (Kevin): the analysis writes it.
 */

/** House style: no em or en dash in what we show. */
const clean = (s: string) => s.replace(/\s*[—–]\s*/g, ", ").trim();

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
