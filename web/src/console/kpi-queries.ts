import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { kpiDrivers } from "@/db/schema/analysis";

/** A ticker's KPI drivers (Kevin + Thierry 2026-11-19), rank order. */
export const kpiDriversOf = cache(async (symbol: string) => getDb().select().from(kpiDrivers).where(eq(kpiDrivers.symbol, symbol)).orderBy(asc(kpiDrivers.rank)));

/** One KPI driver (its item panel). */
export async function kpiDriver(id: string) {
  return (await getDb().select().from(kpiDrivers).where(eq(kpiDrivers.id, id)))[0] ?? null;
}
