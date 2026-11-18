import { Badge } from "@cloudflare/kumo";
import { ArrowsClockwiseIcon, FileTextIcon, TrendUpIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { findQuote } from "@/collectors/dimensions/filing-documents/text";
import type { DocCitation, GoldNarrativeState, GoldPriceMove, GoldPriceMoveCause, ThesisSide } from "@/db/schema/analysis";
import { docItemId } from "./document-page";
import { Drawer, Drawers } from "./drawer";
import { TagBadge } from "./tag-badge";

/**
 * The top of a Narrative Driver panel (INFLECTION-1117, Kevin 2026-11-17: « la raison doit être résumée très clairement
 * et le plus concisément possible en haut… le détail est disponible en dessous »): the reason in one sentence with its
 * tag (« Weak inflection · Structural »), then What changed (management's words, each quote one click from its page),
 * then What moved the stock (the significant moves that made it a driver). Pure: the panel and its test render it.
 */

const signed = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const shortDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A citation chip: the document and page, opening the page with the quote highlighted. */
function CitationChip({ c, href }: { c: DocCitation; href: string }) {
  return (
    <Link href={href} scroll={false} title={c.quote} className="mx-0.5 inline-flex max-w-[18rem] items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-sm text-kumo-link ring-1 ring-kumo-hairline hover:bg-kumo-tint">
      <FileTextIcon size={13} className="shrink-0" aria-hidden />
      <span className="truncate">{c.title ?? "Company document"}</span>
      <span className="shrink-0 tabular">p. {c.page}</span>
    </Link>
  );
}

/** The explanation with each quote's chip right after the words it quotes; a quote not found in the text gets its chip at the end. */
export function ExplanationWithCitations({ text, citations, hrefFor }: { text: string; citations: DocCitation[]; hrefFor: (item: string) => string }) {
  const placed = citations
    .map((c, i) => ({ c, i, at: findQuote(text, c.quote) }))
    .filter((x): x is { c: DocCitation; i: number; at: [number, number] } => x.at !== null)
    .sort((a, b) => a.at[1] - b.at[1]);
  const rest = citations.filter((_, i) => !placed.some((p) => p.i === i));
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const p of placed) {
    if (p.at[1] < cursor) continue;
    parts.push(text.slice(cursor, p.at[1]));
    parts.push(<CitationChip key={`c${p.i}`} c={p.c} href={hrefFor(docItemId(p.c.documentId, p.c.page, p.c.quote))} />);
    cursor = p.at[1];
  }
  parts.push(text.slice(cursor));
  return (
    <p className="text-base leading-relaxed text-kumo-default">
      {parts}
      {rest.map((c, i) => (
        <CitationChip key={`r${i}`} c={c} href={hrefFor(docItemId(c.documentId, c.page, c.quote))} />
      ))}
    </p>
  );
}

export type DriverMove = GoldPriceMove & { cause: GoldPriceMoveCause | null };

export function DriverReason({ state, side, moves, hrefFor, children }: { state: GoldNarrativeState | null; side: ThesisSide; moves: DriverMove[]; hrefFor: (item: string) => string; /** More drawers of the panel, after these. */ children?: React.ReactNode }) {
  const top = state?.reason ?? state?.why ?? null;
  const m = state?.magnitude;
  return (
    <>
      {state && (
        <div className="flex flex-col gap-3">
          <span className="flex flex-wrap items-center gap-2">
            <TagBadge effect={state.effect} strength={state.strength} side={side} durability={state.durability} />
            {m && (
              <Badge variant="outline">
                {`${m.figure}${m.from && m.to ? `: ${m.from} to ${m.to}` : ""}${m.change ? ` (${m.change})` : ""}`}
              </Badge>
            )}
          </span>
          {top && <p className="text-xl leading-snug font-semibold text-kumo-strong">{top}</p>}
        </div>
      )}
      <Drawers>
      {state?.explanation && (
        <Drawer icon={<ArrowsClockwiseIcon size={16} aria-hidden />} title="What changed">
          <ExplanationWithCitations text={state.explanation} citations={state.citations ?? []} hrefFor={hrefFor} />
        </Drawer>
      )}
      {moves.length > 0 && (
        <Drawer icon={<TrendUpIcon size={16} aria-hidden />} title={`What moved the stock · ${moves.length}`}>
          <ul className="flex flex-col gap-3">
            {moves.map((x) => (
              <li key={x.id}>
                <Link href={hrefFor(`move:${x.id}`)} scroll={false} className="flex flex-col gap-1 hover:underline">
                  <span className="text-base font-medium text-kumo-strong">
                    {`${x.direction === "up" ? "Rise" : "Fall"} of ${signed(x.returnPct)} on ${shortDay(x.startDay)}`} <span className="text-kumo-subtle">›</span>
                  </span>
                  {x.cause?.fact && <span className="text-sm text-kumo-default">{x.cause.fact}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Drawer>
      )}
      {children}
      </Drawers>
    </>
  );
}
