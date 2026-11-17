import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companyProfiles } from "@/db/schema/gold";
import { documentPage } from "@/collectors/dimensions/filing-documents/read";

/** One page of a stored company document (`doc:` item), with the company's name; null when it is not this ticker's. */
export async function documentPageDetail(symbol: string, documentId: string, page: number) {
  const db = getDb();
  const [found, [profile]] = await Promise.all([
    documentPage(db, documentId, page),
    db.select({ name: companyProfiles.name }).from(companyProfiles).where(eq(companyProfiles.symbol, symbol)),
  ]);
  if (!found || found.document.symbol !== symbol) return null;
  return { ...found, company: profile?.name ?? symbol };
}
