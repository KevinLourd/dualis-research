import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { BENCHMARK } from "@/collectors/benchmark";
import { positionReturn } from "@/content/signal-words";
import { getDb } from "@/db/client";
import { companyProfiles, priceBars, quotes, tickers } from "@/db/schema/gold";
import { portfolioPositions } from "@/db/schema/portfolio";
import { type Bar, type DrawablePosition, returnLines } from "./portfolio-series";

/** Portfolio page: one row per position (his entry, the last close, the return) and the chart's lines. Gold only. */
export async function portfolioView() {
  const db = getDb();
  const rows = await db
    .select({
      symbol: tickers.symbol,
      name: companyProfiles.name,
      logoUrl: companyProfiles.logoUrl,
      profileCurrency: companyProfiles.currency,
      close: quotes.close,
      quoteDate: quotes.date,
      quoteCurrency: quotes.currency,
      position: portfolioPositions,
    })
    .from(tickers)
    .leftJoin(companyProfiles, eq(companyProfiles.symbol, tickers.symbol))
    .leftJoin(quotes, eq(quotes.symbol, tickers.symbol))
    .leftJoin(portfolioPositions, eq(portfolioPositions.symbol, tickers.symbol))
    .where(eq(tickers.inPortfolio, true))
    .orderBy(asc(tickers.symbol));

  const positions = rows.map((r) => {
    const p = r.position;
    const direction = p?.direction ?? null;
    return {
      symbol: r.symbol,
      name: r.name,
      logoUrl: r.logoUrl,
      currency: r.quoteCurrency ?? r.profileCurrency,
      close: r.close,
      quoteDate: r.quoteDate,
      direction,
      entryDate: p?.entryDate ?? null,
      entryPrice: p?.entryPrice ?? null,
      weight: p?.weight ?? null,
      status: p?.status ?? null,
      reportedReturn: p?.reportedReturn ?? null,
      reportedReturnAsOf: p?.reportedReturnAsOf ?? null,
      provenance: p?.provenance ?? {},
      return: positionReturn(p?.entryPrice ?? null, r.close, direction),
    };
  });

  const drawable: DrawablePosition[] = positions.flatMap((p) =>
    p.entryDate && p.entryPrice && (p.direction === "long" || p.direction === "short")
      ? [{ symbol: p.symbol, direction: p.direction, entryDate: p.entryDate, entryPrice: p.entryPrice, weight: p.weight }]
      : [],
  );
  const start = drawable.map((p) => p.entryDate).sort()[0];
  const bars = start
    ? await db
        .select({ symbol: priceBars.symbol, date: priceBars.date, close: priceBars.close })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, [...drawable.map((p) => p.symbol), BENCHMARK]), gte(priceBars.date, start)))
        .orderBy(asc(priceBars.date))
    : [];
  const bySymbol = new Map<string, Bar[]>();
  for (const b of bars) bySymbol.set(b.symbol, [...(bySymbol.get(b.symbol) ?? []), b]);
  const allWeighted = drawable.length === positions.length && positions.every((p) => p.weight !== null && p.weight > 0);
  return { positions, lines: returnLines(drawable, bySymbol, bySymbol.get(BENCHMARK) ?? [], allWeighted), allWeighted };
}
export type PortfolioRow = Awaited<ReturnType<typeof portfolioView>>["positions"][number];
