import { Badge } from "@cloudflare/kumo";
import { ChartLineUpIcon, PencilSimpleIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { day, price, signedPct } from "@/console/format";
import { CompanyLogo } from "@/console/market";
import { type PortfolioRow, portfolioView } from "@/console/portfolio-queries";
import { PositionForm } from "@/console/position-form";
import { ReturnChart } from "@/console/return-chart";
import { SlideOver } from "@/console/slide-over";
import { Card, ComingNext, PageHeader } from "@/console/ui";

export const metadata = { title: "Portfolio" };

/** A value a post stated links to the sentence that says it. */
function Cite({ row, field }: { row: PortfolioRow; field: string }) {
  const cite = row.provenance[field]?.cite;
  if (!cite) return null;
  return (
    <a
      href={cite.post}
      target="_blank"
      rel="noreferrer"
      title={`“${cite.quote}” (${cite.title}, ${day(cite.date)})`}
      className="text-sm text-kumo-subtle underline decoration-kumo-line underline-offset-2 hover:text-kumo-link"
    >
      his post
    </a>
  );
}

const empty = <span className="text-kumo-subtle">–</span>;

function ReturnCell({ row }: { row: PortfolioRow }) {
  if (row.return !== null) {
    return <span className={`font-mono tabular ${row.return >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>{signedPct(row.return)}</span>;
  }
  if (row.reportedReturn !== null) {
    return (
      <span className="flex flex-col items-end">
        <span className={`font-mono tabular ${row.reportedReturn >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>{signedPct(row.reportedReturn)}</span>
        <span className="text-sm text-kumo-subtle">
          on {day(row.reportedReturnAsOf!)}, <Cite row={row} field="reportedReturn" />
        </span>
      </span>
    );
  }
  return empty;
}

/** Thierry's positions: his P&L against the S&P 500 since he entered, then one row per position. */
export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const { positions, lines, allWeighted } = await portfolioView();
  const editing = edit ? positions.find((p) => p.symbol === edit) : undefined;

  return (
    <>
      <PageHeader title="Portfolio" description="What you hold, against the S&P 500 since you entered. Add your entry on a row to draw it." />

      <Card title={allWeighted ? "Portfolio vs S&P 500, since inception" : "Each position vs S&P 500, since its entry"}>
        <div className="p-5">
          {lines.length === 0 ? (
            <ComingNext
              bare
              icon={<ChartLineUpIcon size={40} className="text-kumo-inactive" />}
              title="No entry yet"
              description="Add the entry date and price of a position: its return since then shows here against the S&P 500 over the same days."
            />
          ) : (
            <ReturnChart lines={lines} />
          )}
        </div>
      </Card>

      <div className="rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
        <KTable>
          <KTableHeader>
            <KTableRow>
              <KTableHead className="pl-6">Company</KTableHead>
              <KTableHead>Direction</KTableHead>
              <KTableHead className="text-right">Entry</KTableHead>
              <KTableHead className="text-right">Current</KTableHead>
              <KTableHead className="text-right">Return</KTableHead>
              <KTableHead className="text-right">Weight</KTableHead>
              <KTableHead className="pr-6">
                <span className="sr-only">Edit</span>
              </KTableHead>
            </KTableRow>
          </KTableHeader>
          <KTableBody>
            {positions.map((p) => (
              <KTableRow key={p.symbol}>
                <KTableCell className="py-4 pl-6">
                  <span className="inline-flex items-center gap-3">
                    <CompanyLogo src={p.logoUrl} name={p.name ?? p.symbol} size={32} />
                    <span className="flex flex-col">
                      <span className="text-base font-medium text-kumo-strong">{p.name ?? p.symbol}</span>
                      <span className="flex items-center gap-2 font-mono text-[12px] text-kumo-subtle">
                        {p.symbol}
                        {p.status === "closed" && <Badge variant="outline">Closed</Badge>}
                      </span>
                    </span>
                  </span>
                </KTableCell>
                <KTableCell className="py-4">
                  {p.direction ? (
                    <span className="flex flex-col items-start gap-1">
                      <Badge variant="secondary" className={p.direction === "long" ? "bg-dualis-long-soft text-dualis-long" : "bg-dualis-short-soft text-dualis-short"}>
                        {p.direction === "long" ? "Long" : "Short"}
                      </Badge>
                      <Cite row={p} field="direction" />
                    </span>
                  ) : (
                    empty
                  )}
                </KTableCell>
                <KTableCell className="py-4 text-right">
                  {p.entryPrice !== null ? (
                    <span className="flex flex-col items-end">
                      <span className="font-mono tabular text-kumo-strong">
                        {price(p.entryPrice)} <span className="text-kumo-subtle">{p.currency}</span>
                      </span>
                      {p.entryDate && <span className="text-sm text-kumo-subtle">{day(p.entryDate)}</span>}
                    </span>
                  ) : (
                    empty
                  )}
                </KTableCell>
                <KTableCell className="py-4 text-right">
                  {p.close !== null ? (
                    <span className="flex flex-col items-end">
                      <span className="font-mono tabular text-kumo-strong">
                        {price(p.close)} <span className="text-kumo-subtle">{p.currency}</span>
                      </span>
                      {p.quoteDate && <span className="text-sm text-kumo-subtle">{day(p.quoteDate)}</span>}
                    </span>
                  ) : (
                    empty
                  )}
                </KTableCell>
                <KTableCell className="py-4 text-right">
                  <ReturnCell row={p} />
                </KTableCell>
                <KTableCell className="py-4 text-right font-mono tabular">{p.weight !== null ? `${(p.weight * 100).toFixed(1)}%` : empty}</KTableCell>
                <KTableCell className="py-4 pr-6 text-right">
                  <Link
                    href={`/portfolio?edit=${encodeURIComponent(p.symbol)}`}
                    scroll={false}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-kumo-default hover:bg-kumo-tint"
                  >
                    <PencilSimpleIcon size={14} aria-hidden /> Edit
                  </Link>
                </KTableCell>
              </KTableRow>
            ))}
          </KTableBody>
        </KTable>
      </div>

      {editing && (
        <SlideOver title={editing.name ?? editing.symbol} subtitle={`${editing.symbol}, your position`} closeHref="/portfolio">
          <PositionForm
            symbol={editing.symbol}
            currency={editing.currency}
            initial={{ direction: editing.direction, entryDate: editing.entryDate, entryPrice: editing.entryPrice, weight: editing.weight, status: editing.status }}
          />
        </SlideOver>
      )}
    </>
  );
}
