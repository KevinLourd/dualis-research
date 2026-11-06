import { and, asc, eq, gte } from "drizzle-orm";
import type { DraftChart } from "@/db/schema/content";
import { priceBars } from "@/db/schema/gold";
import type { Db } from "@/db/types";

/** A chart the article writer may use, with its data already read from gold. */
export type ChartOption = { id: string; label: string; chart: DraftChart };

const PRICE_SOURCE_LABEL: Record<string, string> = {
  yahoo: "Yahoo Finance",
  nasdaq: "Nasdaq",
  cnbc: "CNBC",
  naver: "Naver Finance",
};

/** Charts we can draw for a ticker today: its share price over a year. */
export async function chartOptions(db: Db, symbol: string, companyName: string | null, now = new Date()): Promise<ChartOption[]> {
  const out: ChartOption[] = [];
  const since = new Date(now.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const bars = await db
    .select({ date: priceBars.date, close: priceBars.close, sources: priceBars.sources })
    .from(priceBars)
    .where(and(eq(priceBars.symbol, symbol), gte(priceBars.date, since)))
    .orderBy(asc(priceBars.date));
  if (bars.length >= 20) {
    const sources = [...new Set(bars.flatMap((b) => b.sources))];
    out.push({
      id: "price",
      label: `Share price, last 12 months (${bars.length} closes)`,
      chart: {
        title: `${companyName ?? symbol} share price`,
        unit: null,
        period: "market",
        points: bars.map((b) => ({ date: b.date, value: b.close })),
        sources: sources.map((s) => PRICE_SOURCE_LABEL[s] ?? s),
        kind: "price",
        driverId: null,
      },
    });
  }
  return out;
}
