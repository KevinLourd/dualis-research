import Link from "@/console/link";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { price } from "@/console/format";
import { CompanyLogo, DayChange } from "@/console/market";
import { listTickers } from "@/console/queries";
import { StateBadge } from "@/console/signal";
import { signalStates } from "@/console/signal-queries";
import { Missing, PageHeader, PositionTags } from "@/console/ui";
import { TableSearch } from "@/console/table-search";

export const metadata = { title: "Tickers" };

export default async function TickersPage() {
  const [rows, states] = await Promise.all([listTickers(), signalStates()]);
  const stateOf = new Map(states.map((s) => [s.symbol, s.state]));

  return (
    <>
      <PageHeader title="Tickers" description={`${rows.length} companies on the watchlist. Open one to see its narrative and the news judged against it.`} />
      <TableSearch placeholder="Search a company or ticker">
      <div className="overflow-x-auto rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
        <KTable>
          <KTableHeader>
            <KTableRow>
              <KTableHead className="pl-6">Company</KTableHead>
              <KTableHead>Position</KTableHead>
              <KTableHead className="text-right">Last close</KTableHead>
              <KTableHead className="text-right">Day</KTableHead>
              <KTableHead className="pr-6">Narrative</KTableHead>
            </KTableRow>
          </KTableHeader>
          <KTableBody>
            {rows.map((t) => {
              const state = stateOf.get(t.symbol);
              return (
                <KTableRow key={t.symbol}>
                  <KTableCell className="py-4 pl-6">
                    <Link href={`/tickers/${encodeURIComponent(t.symbol)}`} className="group inline-flex items-center gap-3">
                      <CompanyLogo src={t.logoUrl} name={t.name ?? t.symbol} size={32} />
                      <span className="flex flex-col">
                        <span className="font-mono text-[13px] font-semibold text-kumo-strong group-hover:text-kumo-link">{t.symbol}</span>
                        <span className="text-sm text-kumo-subtle">{t.name ?? <Missing>Not collected yet</Missing>}</span>
                      </span>
                    </Link>
                  </KTableCell>
                  <KTableCell className="py-4"><PositionTags inPortfolio={t.inPortfolio} position={t.position} /></KTableCell>
                  <KTableCell className="py-4 text-right font-mono tabular whitespace-nowrap">
                    {t.lastClose === null ? "–" : <>{price(t.lastClose)} <span className="text-kumo-subtle">{t.quoteCurrency ?? t.currency}</span></>}
                  </KTableCell>
                  <KTableCell className="py-4 text-right"><DayChange ratio={t.changePct} /></KTableCell>
                  <KTableCell className="py-4 pr-6">{state ? <StateBadge state={state} position={t.position} /> : <span className="text-kumo-subtle">–</span>}</KTableCell>
                </KTableRow>
              );
            })}
          </KTableBody>
        </KTable>
      </div>
      </TableSearch>
    </>
  );
}
