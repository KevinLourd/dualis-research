import type { CatalystDirection, CatalystKind } from "@/db/schema/catalysts";
import type { GoldThesis } from "@/db/schema/thesis";

/** The judgment behind a catalyst: (ticker, item) asked once against the ticker's narrative. */
export const SUBJECT_KIND: Record<CatalystKind, string> = { news: "news-ticker", filing: "filing-ticker" };
/** Bump when the question changes meaning: old judgments stay stored, new ones are asked again. v3 = vs the narrative. */
export const CATALYST_QUESTION_KEY = "catalyst@v3";
export const NONE = "none";
export const CHOICES = ["contradicts", "continues", NONE] as const satisfies readonly (CatalystDirection | typeof NONE)[];

export const itemSubject = (symbol: string, itemId: string) => `${symbol}|${itemId}`;
export function parseItemSubject(subject: string): { symbol: string; itemId: string } {
  const i = subject.lastIndexOf("|");
  if (i < 0) throw new Error(`catalysts: subject "${subject}" is not <symbol>|<itemId>`);
  return { symbol: subject.slice(0, i), itemId: subject.slice(i + 1) };
}

/** What the judge reads about one item: a news article or a filing. */
export type JudgedItem = { kind: CatalystKind; title: string; publisher: string | null; summary: string | null; at: Date | null };

/**
 * The narrative and the view go in the QUESTION; the INPUT is only the item, so the cited sentence is always a
 * sentence of the news or filing.
 */
export function catalystRequest(
  ticker: { symbol: string; name: string | null; position: string | null },
  thesis: Pick<GoldThesis, "narrative" | "summary"> | null,
  item: JudgedItem,
): { question: string; input: string; choices: string[] } {
  const question = [
    `Ticker ${ticker.symbol}${ticker.name ? ` (${ticker.name})` : ""}, the analyst's position: ${ticker.position ?? "watch"}.`,
    `The market's narrative (what the price reflects): ${thesis?.narrative ?? "not written yet"}`,
    `The analyst's view of it: ${thesis?.summary ?? "not written yet"}`,
    "",
    `Does the ${item.kind === "filing" ? "filing" : "article"} below bring NEW information about this company that bears on the market's narrative?`,
    "contradicts = it goes against the narrative: a crack in the story the market tells (a fact the narrative does not expect).",
    "continues = it confirms the narrative: more of the story the market already tells.",
    `${NONE} = not about this company, a share price recap, index or listing notes, opinion without new facts, routine paperwork, or an event already reported more than a week before.`,
    "Results, guidance, a deal, a contract, a regulator or court decision, a management or board change, an activist, a capital return or raise, an industry figure the company depends on: these bear on the narrative.",
    "Probability = how sure you are of the verdict. A headline alone is enough when it states the fact.",
  ].join("\n");
  const input = [
    `Title: ${item.title}`,
    item.publisher ? `${item.kind === "filing" ? "Registry" : "Publisher"}: ${item.publisher}` : null,
    item.at ? `Date: ${item.at.toISOString().slice(0, 10)}` : null,
    item.summary ? `Summary: ${item.summary}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { question, input, choices: [...CHOICES] };
}
