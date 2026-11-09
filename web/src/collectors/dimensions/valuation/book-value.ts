import type { GoldCompanyProfile } from "@/db/schema/gold";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { judge } from "@/llm/judge";
import { fnv } from "../analysis/facts";
import type { ValuationFacts } from "./methods";

/**
 * Does book value drive this company's value? One stored judgment per company profile (PB-WEIGHT-1109, Thierry on
 * CareCloud 2026-11-06: « the book value is like intangible »). When it does not, P/B is not applicable: weight 0,
 * its why on the Methods table, no LLM call for its scenarios. Never a sector rule: the judge reads what the company does.
 */
export const BOOK_VALUE_SUBJECT_KIND = "company-profile";
export const BOOK_VALUE_QUESTION = "book-value-drives@v1";
const CHOICES = ["drives", "does-not-drive"] as const;

const QUESTION = [
  "Does the book value of this company's assets and equity drive what the company is worth, so that an investor would sensibly price it on price to book?",
  "The test (Damodaran): book value matters when the company earns its return on the assets it carries at a fair value on the balance sheet, as banks, insurers and asset-heavy firms do.",
  "It is mostly irrelevant when value comes from people, software, customer relationships, brands or other intangibles that the balance sheet does not hold, or holds as acquired goodwill.",
  "Answer drives or does-not-drive. In the reason, name what the company does and why its book value does or does not measure its worth.",
].join(" ");

export function bookValueInput(symbol: string, profile: Pick<GoldCompanyProfile, "name" | "sector" | "industry" | "description"> | undefined): string {
  return [
    `Company: ${profile?.name ?? symbol} (${symbol})`,
    profile?.sector ? `Sector: ${profile.sector}` : null,
    profile?.industry ? `Industry: ${profile.industry}` : null,
    profile?.description ? `What it does: ${profile.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function bookValueJudgment(db: Db, symbol: string, profile: Parameters<typeof bookValueInput>[1], complete: Complete): Promise<NonNullable<ValuationFacts["bookValue"]>> {
  const input = bookValueInput(symbol, profile);
  const j = await judge(db, { subjectKind: BOOK_VALUE_SUBJECT_KIND, subjectId: symbol, questionKey: `${BOOK_VALUE_QUESTION}:${fnv(input)}`, question: QUESTION, input, choices: CHOICES }, complete);
  return { drives: j.verdict === "drives", why: j.reason };
}
