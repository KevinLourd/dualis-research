import { and, asc, desc, gte, inArray } from "drizzle-orm";
import { BENCHMARK } from "@/collectors/benchmark";
import { getDb } from "@/db/client";
import { livePositions, signalEvents } from "@/db/schema/analysis";
import { companyProfiles, priceBars } from "@/db/schema/gold";
import type { Bar } from "./portfolio-series";

/**
 * Live test page: the stored signal events and positions (gold, rebuilt by `signals`), the companies' names and logos,
 * and the daily closes the P&L curve needs, from the first signal day on only (Neon egress rule). Never the Portfolio
 * page's real positions.
 */
export async function liveTestView() {
  const db = getDb();
  const [events, positions] = await Promise.all([
    db.select().from(signalEvents).orderBy(desc(signalEvents.at)),
    db.select().from(livePositions).orderBy(desc(livePositions.openedAt)),
  ]);
  const start = events.length ? events.map((e) => e.at.toISOString().slice(0, 10)).sort()[0] : null;
  const symbols = [...new Set([...events.map((e) => e.symbol), ...positions.map((p) => p.symbol)])];
  const firstEntry = [start, ...positions.map((p) => p.entryDate)].filter((d): d is string => d !== null).sort()[0];
  const traded = [...new Set(positions.map((p) => p.symbol))];
  const [profiles, rows] = await Promise.all([
    symbols.length ? db.select({ symbol: companyProfiles.symbol, name: companyProfiles.name, logoUrl: companyProfiles.logoUrl }).from(companyProfiles).where(inArray(companyProfiles.symbol, symbols)) : [],
    firstEntry
      ? db
          .select({ symbol: priceBars.symbol, date: priceBars.date, close: priceBars.close })
          .from(priceBars)
          .where(and(inArray(priceBars.symbol, [...traded, BENCHMARK]), gte(priceBars.date, firstEntry)))
          .orderBy(asc(priceBars.date))
      : [],
  ]);
  const bars: Record<string, Bar[]> = {};
  for (const b of rows) (bars[b.symbol] ??= []).push({ date: b.date, close: b.close });
  const benchmark = bars[BENCHMARK] ?? [];
  delete bars[BENCHMARK];
  const companies = Object.fromEntries(profiles.map((p) => [p.symbol, { name: p.name, logoUrl: p.logoUrl }]));
  return { start, events, positions, bars, benchmark, companies };
}
export type LiveTestView = Awaited<ReturnType<typeof liveTestView>>;
