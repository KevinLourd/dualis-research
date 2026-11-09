import { Badge } from "@cloudflare/kumo";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { day, price, relativeTime, signedPct, utc } from "@/console/format";
import { signalLabel } from "@/console/live-test";
import { LivePnl } from "@/console/live-test-pnl";
import { type LiveTestView, liveTestView } from "@/console/live-test-queries";
import { type LiveTab, LiveTestTabs } from "@/console/live-test-tabs";
import { CompanyLogo } from "@/console/market";
import { TableSearch } from "@/console/table-search";
import { Card, PageHeader } from "@/console/ui";

export const metadata = { title: "Live test" };

type Position = LiveTestView["positions"][number];
type Companies = LiveTestView["companies"];

const empty = <span className="text-kumo-subtle">–</span>;

function Pct({ value }: { value: number | null }) {
  if (value === null) return empty;
  return <span className={`font-mono tabular ${value >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>{signedPct(value)}</span>;
}

function Company({ symbol, companies }: { symbol: string; companies: Companies }) {
  const c = companies[symbol];
  return (
    <span className="inline-flex items-center gap-3">
      <CompanyLogo src={c?.logoUrl ?? null} name={c?.name ?? symbol} size={32} />
      <span className="flex flex-col">
        <span className="text-base font-medium text-kumo-strong">{c?.name ?? symbol}</span>
        <span className="font-mono text-[12px] text-kumo-subtle">{symbol}</span>
      </span>
    </span>
  );
}

function SignalCell({ p }: { p: Position }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant="secondary" className={p.side === "long" ? "bg-dualis-long-soft text-dualis-long" : "bg-dualis-short-soft text-dualis-short"}>
        {p.side === "long" ? "Long" : "Short"}
      </Badge>
      <span className="text-sm text-kumo-subtle">{signalLabel(p.side === "long" ? "BUY" : "SELL", p.strength)}</span>
    </span>
  );
}

/** When the price was known: « 6 Nov 2026, 14:35 UTC » for a 5-minute price, « 6 Nov 2026 close » when the market was shut. */
function when(date: string | null, at: Date | null, source: string | null): string | null {
  if (!date) return null;
  if (source === "intraday" && at) return `${day(date)}, ${at.toISOString().slice(11, 16)} UTC`;
  return `${day(date)} close`;
}

function PriceCell({ value, date, currency, missing }: { value: number | null; date: string | null; currency: string | null; missing: string }) {
  if (value === null) return <span className="text-sm text-kumo-subtle">{missing}</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular text-kumo-strong">
        {price(value)} <span className="text-kumo-subtle">{currency}</span>
      </span>
      {date && <span className="text-sm text-kumo-subtle">{date}</span>}
    </span>
  );
}

function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
      <KTable>
        <KTableHeader>
          <KTableRow>{head}</KTableRow>
        </KTableHeader>
        <KTableBody>{children}</KTableBody>
      </KTable>
    </div>
  );
}

function held(from: Date, to: Date): string {
  const h = Math.round((to.getTime() - from.getTime()) / 3_600_000);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** What following the Signal would have returned: the P&L with its weak-weight cursor, then open / closed positions and every signal event. */
export default async function LiveTestPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab: LiveTab = raw === "closed" || raw === "history" ? raw : "open";
  const { start, events, positions, bars, benchmark, companies } = await liveTestView();
  const open = positions.filter((p) => p.closedAt === null);
  const closed = positions.filter((p) => p.closedAt !== null);
  const now = new Date();

  return (
    <>
      <PageHeader title="Live test" description={`What following the Signal would have returned.${start ? ` Live since ${day(start)}.` : ""} No trading costs counted.`} />

      <Card title="Signal book vs S&P 500">
        <LivePnl
          positions={positions.map((p) => ({ symbol: p.symbol, side: p.side, strength: p.strength, entryDate: p.entryDate, entryPrice: p.entryPrice, exitDate: p.exitDate, exitPrice: p.exitPrice, markDate: p.markDate, markPrice: p.markPrice, closedAt: p.closedAt }))}
          bars={bars}
          benchmark={benchmark}
          open={open.length}
          closed={closed.length}
          won={closed.filter((p) => (p.return ?? 0) > 0).length}
        />
      </Card>

      <TableSearch placeholder="Search a company or ticker" tabs={<LiveTestTabs value={tab} open={open.length} closed={closed.length} history={events.length} />}>
        {tab === "open" &&
          (open.length === 0 ? (
            <p className="text-base text-kumo-subtle">No open position: no ticker has a signal right now.</p>
          ) : (
            <Table
              head={
                <>
                  <KTableHead className="pl-6">Company</KTableHead>
                  <KTableHead>Signal</KTableHead>
                  <KTableHead className="text-right">Entry</KTableHead>
                  <KTableHead className="text-right">Current</KTableHead>
                  <KTableHead className="text-right">Return</KTableHead>
                  <KTableHead className="pr-6 text-right">Invested since</KTableHead>
                </>
              }
            >
              {open.map((p) => (
                <KTableRow key={p.id}>
                  <KTableCell className="py-4 pl-6"><Company symbol={p.symbol} companies={companies} /></KTableCell>
                  <KTableCell className="py-4"><SignalCell p={p} /></KTableCell>
                  <KTableCell className="py-4 text-right"><PriceCell value={p.entryPrice} date={when(p.entryDate, p.entryAt, p.entrySource)} currency={p.currency} missing="No price yet" /></KTableCell>
                  <KTableCell className="py-4 text-right"><PriceCell value={p.markPrice} date={when(p.markDate, p.markAt, p.markSource)} currency={p.currency} missing="–" /></KTableCell>
                  <KTableCell className="py-4 text-right"><Pct value={p.return} /></KTableCell>
                  <KTableCell className="py-4 pr-6 text-right text-kumo-default" title={utc(p.openedAt)}>{relativeTime(p.openedAt, now)}</KTableCell>
                </KTableRow>
              ))}
            </Table>
          ))}

        {tab === "closed" &&
          (closed.length === 0 ? (
            <p className="text-base text-kumo-subtle">No closed position yet.</p>
          ) : (
            <Table
              head={
                <>
                  <KTableHead className="pl-6">Company</KTableHead>
                  <KTableHead>Signal</KTableHead>
                  <KTableHead className="text-right">Entry</KTableHead>
                  <KTableHead className="text-right">Exit</KTableHead>
                  <KTableHead className="text-right">Return</KTableHead>
                  <KTableHead className="pr-6 text-right">Held</KTableHead>
                </>
              }
            >
              {closed.map((p) => (
                <KTableRow key={p.id}>
                  <KTableCell className="py-4 pl-6"><Company symbol={p.symbol} companies={companies} /></KTableCell>
                  <KTableCell className="py-4"><SignalCell p={p} /></KTableCell>
                  <KTableCell className="py-4 text-right"><PriceCell value={p.entryPrice} date={when(p.entryDate, p.entryAt, p.entrySource)} currency={p.currency} missing="No price stored" /></KTableCell>
                  <KTableCell className="py-4 text-right"><PriceCell value={p.exitPrice} date={when(p.exitDate, p.exitAt, p.exitSource)} currency={p.currency} missing="No price stored" /></KTableCell>
                  <KTableCell className="py-4 text-right"><Pct value={p.return} /></KTableCell>
                  <KTableCell className="py-4 pr-6 text-right text-kumo-default" title={`${utc(p.openedAt)} to ${utc(p.closedAt!)}`}>{held(p.openedAt, p.closedAt!)}</KTableCell>
                </KTableRow>
              ))}
            </Table>
          ))}

        {tab === "history" &&
          (events.length === 0 ? (
            <p className="text-base text-kumo-subtle">No signal yet.</p>
          ) : (
            <Table
              head={
                <>
                  <KTableHead className="pl-6">When</KTableHead>
                  <KTableHead>Company</KTableHead>
                  <KTableHead>Signal</KTableHead>
                  <KTableHead className="pr-6">Note</KTableHead>
                </>
              }
            >
              {events.map((e) => (
                <KTableRow key={e.id}>
                  <KTableCell className="py-4 pl-6 whitespace-nowrap font-mono text-sm tabular text-kumo-default">{utc(e.at)}</KTableCell>
                  <KTableCell className="py-4"><Company symbol={e.symbol} companies={companies} /></KTableCell>
                  <KTableCell className="py-4 whitespace-nowrap">
                    {e.fromSignal === null ? (
                      <span className="text-kumo-strong">{signalLabel(e.signal, e.strength)} <span className="text-sm text-kumo-subtle">first reading</span></span>
                    ) : (
                      <span className="text-kumo-strong">
                        <span className="text-kumo-subtle">{signalLabel(e.fromSignal, e.fromStrength)}</span> → {signalLabel(e.signal, e.strength)}
                      </span>
                    )}
                  </KTableCell>
                  <KTableCell className="max-w-md py-4 pr-6 text-sm text-kumo-default">{e.updateNote ?? empty}</KTableCell>
                </KTableRow>
              ))}
            </Table>
          ))}
      </TableSearch>
    </>
  );
}
