import { CaretRightIcon } from "@phosphor-icons/react/ssr";
import { Badge } from "@cloudflare/kumo";
import { ConfidenceBadge } from "@/console/confidence-badge";
import { itemView } from "@/console/item-detail";
import { ItemPanelHost } from "@/console/item-panel-host";
import { kpiDriversOf } from "@/console/kpi-queries";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { RowLink } from "@/console/row-link";
import { Section } from "@/console/signal";

export const metadata = { title: "Drivers" };

/**
 * Every KPI the AI found for a ticker, untrusted ones included (Kevin + Thierry 2026-11-19): the KPI, how far it can be
 * trusted after every results release of 3 years, and whether it turns now. A row opens the release-by-release test.
 */
export default async function DriversPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ item?: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const { item } = await searchParams;
  const [kpis, view] = await Promise.all([kpiDriversOf(symbol), item ? itemView(symbol, item) : null]);
  const base = `/tickers/${encodeURIComponent(symbol)}/drivers`;
  return (
    <div className="flex max-w-4xl flex-col pt-6">
      <Section title="Narrative drivers">
        {kpis.length === 0 ? (
          <p className="text-lg text-kumo-subtle">Not tested yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
            <KTable>
              <KTableHeader>
                <KTableRow>
                  <KTableHead className="pl-4">KPI</KTableHead>
                  <KTableHead>Confidence</KTableHead>
                  <KTableHead>Tests</KTableHead>
                  <KTableHead>Now</KTableHead>
                  <KTableHead className="w-10 pr-4" />
                </KTableRow>
              </KTableHeader>
              <KTableBody>
                {kpis.map((k) => (
                  <RowLink key={k.id} href={`${base}?item=${encodeURIComponent(`kdriver:${k.id}`)}`} label={`Open ${k.name}`}>
                    <KTableCell className="py-3 pl-4">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-base font-medium text-kumo-strong">{k.name}</span>
                        <span className="text-sm text-kumo-subtle">{k.why}</span>
                      </span>
                    </KTableCell>
                    <KTableCell className="py-3">
                      <ConfidenceBadge level={k.level === "none" ? "noise" : k.level} />
                    </KTableCell>
                    <KTableCell className="py-3 text-sm whitespace-nowrap tabular text-kumo-default">
                      ✓ {k.confirmed} · ✗ {k.invalidated}
                    </KTableCell>
                    <KTableCell className="py-3">
                      {k.signal === "strong" || k.signal === "weak" ? (
                        <Badge appearance="dot" variant={k.signal === "strong" ? "success" : "warning"}>{`${k.signal === "strong" ? "Strong" : "Weak"} turn${k.direction ? ` · ${k.direction}` : ""}`}</Badge>
                      ) : (
                        <span className="text-sm text-kumo-subtle">–</span>
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
      <ItemPanelHost symbol={symbol} base={base} shown={null} competing={false} initial={item ? { item, thesis: null, view: view && { title: view.title, subtitle: view.subtitle ?? null, body: view.body } } : null} />
    </div>
  );
}
