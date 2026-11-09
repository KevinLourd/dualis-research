import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { theses } from "@/db/schema/thesis";

/** Thierry's own fair value on file (gold.theses: value, currency, basis), for the "Your fair value" form. */
export const getThesis = cache(async (symbol: string) => (await getDb().select().from(theses).where(eq(theses.symbol, symbol)))[0] ?? null);
