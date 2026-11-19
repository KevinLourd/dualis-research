import { CaretRightIcon } from "@phosphor-icons/react/ssr";
import { parseThesis } from "@/console/analysis";
import { getTickerAnalysis } from "@/console/analysis-queries";
import { ConfidenceBadge } from "@/console/confidence-badge";
import { itemView } from "@/console/item-detail";
import { ItemPanelHost } from "@/console/item-panel-host";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { RowLink } from "@/console/row-link";
import { Section } from "@/console/signal";
import { TagBadge } from "@/console/tag-badge";

export const metadata = { title: "Drivers" };

/**
 * Every Narrative Driver of a ticker, noise included (Kevin 2026-11-19, « dans une sous-page de chaque ticker »): the
 * driver, how far it can be trusted (Temporal Confidence), and whether it turns now (Driver Signal). A row opens why.
 */
export default async function DriversPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ item?: string; thesis?: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const { item, thesis: t } = await searchParams;
  const thesis = parseThesis(t);
  const [a, view] = await Promise.all([getTickerAnalysis(symbol, thesis), item ? itemView(symbol, item, thesis) : null]);
  const base = `/tickers/${encodeURIComponent(symbol)}/drivers`;
  const href = (it: string) => `${base}?item=${encodeURIComponent(it)}${t ? `&thesis=${t}` : ""}`;
  return (
    <div className="flex max-w-4xl flex-col pt-6">
      <Section title="Narrative drivers">
        {a.drivers.length === 0 ? (
          <p className="text-lg text-kumo-subtle">No driver yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
            <KTable>
              <KTableHeader>
                <KTableRow>
                  <KTableHead className="pl-4">Driver</KTableHead>
                  <KTableHead>Confidence</KTableHead>
                  <KTableHead>Signal now</KTableHead>
                  <KTableHead className="w-10 pr-4" />
                </KTableRow>
              </KTableHeader>
              <KTableBody>
                {a.drivers.map((d) => (
                  <RowLink key={d.id} href={href(`confidence:${d.id}`)} label={`Open ${d.title}`}>
                    <KTableCell className="py-3 pl-4">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm text-kumo-subtle">{d.category}</span>
                        <span className="text-base font-medium text-kumo-strong">{d.title}</span>
                      </span>
                    </KTableCell>
                    <KTableCell className="py-3">
                      <ConfidenceBadge level={d.confidence?.level ?? null} />
                    </KTableCell>
                    <KTableCell className="py-3">
                      {d.state && a.side && d.confidence && d.confidence.level !== "noise" ? (
                        <TagBadge effect={d.state.effect} strength={d.state.strength} side={a.side} durability={d.state.durability} />
                      ) : (
                        <span className="text-sm text-kumo-subtle">Not asked</span>
                      )}
                    </KTableCell>
                    <KTableCell className="py-3 pr-4 text-right">
                      <CaretRightIcon size={16} weight="bold" aria-hidden className="text-kumo-subtle" />
                    </KTableCell>
                  </RowLink>
                ))}
              </KTableBody>
            </KTable>
          </div>
        )}
      </Section>
      <ItemPanelHost
        symbol={symbol}
        base={base}
        shown={a.side}
        competing={a.theses.length > 1}
        initial={item ? { item, thesis: t ?? null, view: view && { title: view.title, subtitle: view.subtitle ?? null, body: view.body } } : null}
      />
    </div>
  );
}
