import { desc, inArray, sql } from "drizzle-orm";
import * as gold from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Tick } from "@/console/live-test";
import { INTRADAY_MINUTES } from "./index";

type Raw = { symbol: string; at: string | Date; date: string; close: number | string };
/** postgres.js returns the rows, neon-http and PGlite `{ rows }`. */
const rowsOf = (r: unknown): Raw[] => (Array.isArray(r) ? r : (r as { rows: Raw[] }).rows);
const tickOf = (r: Raw): Tick & { symbol: string } => ({ symbol: r.symbol, at: new Date(r.at), date: r.date, close: Number(r.close) });

/**
 * For each (symbol, moment): the last 5-minute bar already closed at that moment, in ONE query (Neon egress rule: never
 * the whole intraday history). Returned per symbol, in time order, deduplicated: a sparse list `priceKnownAt` reads.
 */
export async function ticksKnownAt(db: Db, moments: { symbol: string; at: Date }[]): Promise<Map<string, Tick[]>> {
  const out = new Map<string, Tick[]>();
  if (!moments.length) return out;
  const pairs = JSON.stringify(moments.map((m) => ({ symbol: m.symbol, t: m.at.toISOString() })));
  const result = await db.execute(sql`
    select b.symbol, b.at, b.date, b.close
    from jsonb_to_recordset(${pairs}::jsonb) as q(symbol text, t timestamptz)
    cross join lateral (
      select i.symbol, i.at, i.date, i.close from ${gold.intradayBars} i
      where i.symbol = q.symbol and i.at <= q.t - make_interval(mins => ${INTRADAY_MINUTES})
      order by i.at desc limit 1
    ) b`);
  return group(rowsOf(result).map(tickOf), out);
}

/** The latest 5-minute bar of each symbol (the live price during a session, the session's last price after it). */
export async function latestTicks(db: Db, symbols: string[]): Promise<Map<string, Tick[]>> {
  const out = new Map<string, Tick[]>();
  if (!symbols.length) return out;
  const rows = await db
    .selectDistinctOn([gold.intradayBars.symbol], { symbol: gold.intradayBars.symbol, at: gold.intradayBars.at, date: gold.intradayBars.date, close: gold.intradayBars.close })
    .from(gold.intradayBars)
    .where(inArray(gold.intradayBars.symbol, symbols))
    .orderBy(gold.intradayBars.symbol, desc(gold.intradayBars.at));
  return group(rows, out);
}

/** Both lookups merged per symbol, time order, one tick per bar. */
export function mergeTicks(...maps: Map<string, Tick[]>[]): Map<string, Tick[]> {
  const out = new Map<string, Tick[]>();
  for (const m of maps) for (const [symbol, ticks] of m) group(ticks.map((t) => ({ ...t, symbol })), out);
  return out;
}

function group(ticks: (Tick & { symbol: string })[], out: Map<string, Tick[]>): Map<string, Tick[]> {
  for (const { symbol, ...t } of ticks) {
    const list = out.get(symbol) ?? [];
    if (!list.some((x) => x.at.getTime() === t.at.getTime())) list.push(t);
    out.set(symbol, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}
