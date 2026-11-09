import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { BENCHMARK } from "@/collectors/benchmark";
import { getDb } from "@/db/client";
import { liveBenchmark, livePositions, signalEvents } from "@/db/schema/analysis";
import { companyProfiles, priceBars } from "@/db/schema/gold";
import type { PnlBenchmark } from "./live-test";
import type { Bar } from "./portfolio-series";

/**
 * Live test page: the stored signal events, positions and S&P 500 leg (gold, rebuilt by `signals`, prices at the minute
 * of each signal), the companies' names and logos, and the daily closes the P&L curve needs, from the first signal day on
 * only (Neon egress rule). Never the Portfolio page's real positions.
 */
export async function liveTestView() {
  const db = getDb();
  const [events, positions, [spx]] = await Promise.all([
    db.select().from(signalEvents).orderBy(desc(signalEvents.at)),
    db.select().from(livePositions).orderBy(desc(livePositions.openedAt)),
    db.select().from(liveBenchmark).where(eq(liveBenchmark.symbol, BENCHMARK)),
  ]);
  const startAt = events.length ? events.map((e) => e.at.toISOString()).sort()[0] : null;
  const start = startAt?.slice(0, 10) ?? null;
  const symbols = [...new Set([...events.map((e) => e.symbol), ...positions.map((p) => p.symbol)])];
  // A week earlier (weekends, holidays): the S&P is rebased at the close known when the first signal fired.
  const firstEntry = [start ? new Date(Date.parse(`${start}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10) : null, ...positions.map((p) => p.entryDate)].filter((d): d is string => d !== null).sort()[0];
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
  const benchmark: PnlBenchmark = {
    bars: bars[BENCHMARK] ?? [],
    base: spx ? { price: spx.basePrice, date: spx.baseDate, source: spx.baseSource } : null,
    mark: spx ? { price: spx.markPrice, date: spx.markDate } : null,
  };
  delete bars[BENCHMARK];
  const companies = Object.fromEntries(profiles.map((p) => [p.symbol, { name: p.name, logoUrl: p.logoUrl }]));
  return { start, startAt, events, positions, bars, benchmark, companies };
}
export type LiveTestView = Awaited<ReturnType<typeof liveTestView>>;
