"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { type PositionEdit, recordPositionEdit } from "@/collectors/dimensions/portfolio";
import { withWriteDb } from "@/db/write";

/**
 * Thierry's edits on the Portfolio page: direction, entry day and price, weight, open or closed. Each changed field
 * is one authored version (bronze source "console"), promoted at once: his word wins over what a post said.
 * An empty field is left as it is (nothing is ever guessed or cleared for him).
 */
export async function savePosition(symbol: string, formData: FormData): Promise<void> {
  if (!symbol) throw new Error("No position given");
  const { userId } = await auth();
  const edits: Omit<PositionEdit, "userId">[] = [];
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const number = (k: string) => {
    const raw = text(k).replace(/[, ]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number`);
    return n;
  };

  const direction = text("direction");
  if (direction) {
    if (direction !== "long" && direction !== "short") throw new Error("Direction is long or short");
    edits.push({ field: "direction", value: direction });
  }
  const entryDate = text("entryDate");
  if (entryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw new Error("Entry date is YYYY-MM-DD");
    edits.push({ field: "entryDate", value: entryDate });
  }
  const entryPrice = number("entryPrice");
  if (entryPrice !== null) edits.push({ field: "entryPrice", value: entryPrice });
  const weight = number("weight");
  if (weight !== null) {
    if (weight > 100) throw new Error("Weight is a percent of the portfolio, 100 at most");
    edits.push({ field: "weight", value: weight / 100 });
  }
  const status = text("status");
  if (status) {
    if (status !== "open" && status !== "closed") throw new Error("Status is open or closed");
    edits.push({ field: "status", value: status });
  }

  await withWriteDb(async (db) => {
    for (const e of edits) await recordPositionEdit(db, symbol, { ...e, userId });
  });
  revalidatePath("/portfolio");
}
