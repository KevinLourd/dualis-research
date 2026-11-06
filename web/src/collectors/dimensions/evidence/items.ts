import { and, eq, gte, inArray } from "drizzle-orm";
import * as gold from "@/db/schema/gold";
import { goldNewsItems, goldNewsLinks } from "@/db/schema/news";
import type { Db } from "@/db/types";

/** How far back every news item and filing is judged: one year shows how the narrative moved, and is DART's filing list window. */
export const EVIDENCE_WINDOW_DAYS = 365;

/** One judged item: a news article or a filing of the ticker, as gold holds it. */
export type EvidenceItem = { kind: "news" | "filing"; id: string; title: string; publisher: string | null; summary: string | null; url: string | null; at: Date; sources: string[] };

/** Every news item and filing of the ticker inside the window, newest first. */
export async function itemsOf(db: Db, symbol: string, now = new Date()): Promise<EvidenceItem[]> {
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000);
  const links = await db.select({ id: goldNewsLinks.newsItemId }).from(goldNewsLinks).where(eq(goldNewsLinks.symbol, symbol));
  const news = links.length ? await db.select().from(goldNewsItems).where(inArray(goldNewsItems.id, links.map((l) => l.id))) : [];
  const filed = await db.select().from(gold.filings).where(and(eq(gold.filings.symbol, symbol), gte(gold.filings.filedAt, since)));
  return [
    ...news.map((n) => ({ kind: "news" as const, id: n.id, title: n.title, publisher: n.publisher, summary: n.summary, url: n.url, at: n.publishedAt ?? n.firstSeenAt, sources: n.sources })),
    ...filed.map((f) => ({ kind: "filing" as const, id: f.id, title: f.form ? `${f.form}: ${f.title}` : f.title, publisher: f.registry, summary: null, url: f.url, at: f.filedAt, sources: f.sources })),
  ]
    .filter((x) => x.at >= since)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

