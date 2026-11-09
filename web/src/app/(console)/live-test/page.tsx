import { Badge } from "@cloudflare/kumo";
import { FlaskIcon } from "@phosphor-icons/react/ssr";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { day, price, signedPct } from "@/console/format";
import { STRATEGIES, type StrategyId, type Trade } from "@/console/live-test";
import { liveTestView } from "@/console/live-test-queries";
import { LiveTestTabs } from "@/console/live-test-tabs";
import { ReturnChart } from "@/console/return-chart";
import { TableSearch } from "@/console/table-search";
import { Card, ComingNext, PageHeader } from "@/console/ui";

export const metadata = { title: "Live test" };

const empty = <span className="text-kumo-subtle">–</span>;

function Pct({ value }: { value: number | null }) {
  if (value === null) return empty;
  return <span className={`font-mono tabular ${value >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>{signedPct(value)}</span>;
}

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-kumo-base p-5 ring-1 ring-kumo-hairline">
      <span className="text-sm text-kumo-subtle">{label}</span>
      <span className="text-2xl font-semibold text-kumo-strong">{children}</span>
      {hint && <span className="text-sm text-kumo-subtle">{hint}</span>}
    </div>
  );
}

function PriceCell({ date, value, currency, fallback }: { date: string | null; value: number | null; currency: string | null; fallback: React.ReactNode }) {
  if (value === null) return <>{fallback}</>;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular text-kumo-strong">
        {price(value)} <span className="text-kumo-subtle">{currency}</span>
      </span>
      {date && <span className="text-sm text-kumo-subtle">{day(date)}</span>}
    </span>
  );
}

/** What following the Signal would have returned, per strategy: the curve vs the S&P 500, the stats, every trade. */
export default async function LiveTestPage({ searchParams }: { searchParams: Promise<{ strategy?: string }> }) {
  const { strategy: raw } = await searchParams;
  const strategy: StrategyId = raw && raw in STRATEGIES ? (raw as StrategyId) : "all";
  const { start, trades, lines, stats, meta } = await liveTestView(strategy);
  const vs = stats.benchmarkReturn === null ? null : stats.totalReturn - stats.benchmarkReturn;

  return (
    <>
      <PageHeader
        title="Live test"
        description={`What following the Signal would have returned. ${start ? `Live since ${day(start)}.` : ""} No trading costs counted.`}
      />

      <TableSearch placeholder="Search a ticker" tabs={<LiveTestTabs value={strategy} />}>
        <div className="flex flex-col gap-8">
          <p className="text-base text-kumo-subtle">{STRATEGIES[strategy].description}</p>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Total return">
              <Pct value={stats.totalReturn} />
            </Stat>
            <Stat label="vs S&P 500" hint={stats.benchmarkReturn !== null ? `S&P 500 ${signedPct(stats.benchmarkReturn)}` : undefined}>
              <Pct value={vs} />
            </Stat>
            <Stat label="Trades" hint={`${stats.trades - stats.closed} open`}>
              <span className="font-mono tabular">{stats.trades}</span>
            </Stat>
            <Stat label="Winners">
              <span className="font-mono tabular">{stats.winners === null ? "–" : `${Math.round(stats.winners * 100)}%`}</span>
            </Stat>
            <Stat label="Best / worst" hint={stats.worst ? `${stats.worst.symbol} ${signedPct(stats.worst.return)}` : undefined}>
              {stats.best ? (
                <span className="text-lg">
                  {stats.best.symbol} <Pct value={stats.best.return} />
                </span>
              ) : (
                "–"
              )}
            </Stat>
          </div>

          <Card title={`${STRATEGIES[strategy].label} vs S&P 500`}>
            <div className="p-5">
              {lines.length === 0 ? (
                <ComingNext bare icon={<FlaskIcon size={40} className="text-kumo-inactive" />} title="No signal yet" description="The curve starts on the first signal." />
              ) : (
                <ReturnChart lines={lines} />
              )}
            </div>
          </Card>

          {trades.length === 0 ? (
            <p className="text-base text-kumo-subtle">No trade with this strategy yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
              <KTable>
                <KTableHeader>
                  <KTableRow>
                    <KTableHead className="pl-6">Company</KTableHead>
                    <KTableHead>Side</KTableHead>
                    <KTableHead className="text-right">Entry</KTableHead>
                    <KTableHead className="text-right">Exit</KTableHead>
                    <KTableHead className="text-right">Return</KTableHead>
                    <KTableHead className="pr-6 text-right">Weight</KTableHead>
                  </KTableRow>
                </KTableHeader>
                <KTableBody>
                  {trades.map((t: Trade) => {
                    const m = meta.get(t.symbol);
                    return (
                      <KTableRow key={`${t.symbol}:${t.signalDate}:${t.side}`}>
                        <KTableCell className="py-4 pl-6">
                          <span className="flex flex-col">
                            <span className="text-base font-medium text-kumo-strong">{m?.name ?? t.symbol}</span>
                            <span className="font-mono text-[12px] text-kumo-subtle">{t.symbol}</span>
                          </span>
                        </KTableCell>
                        <KTableCell className="py-4">
                          <span className="inline-flex items-center gap-1.5">
                            <Badge variant="secondary" className={t.side === "long" ? "bg-dualis-long-soft text-dualis-long" : "bg-dualis-short-soft text-dualis-short"}>
                              {t.side === "long" ? "Long" : "Short"}
                            </Badge>
                            <span className="text-sm text-kumo-subtle">{t.strength === "strong" ? "Strong" : "Weak"}</span>
                          </span>
                        </KTableCell>
                        <KTableCell className="py-4 text-right">
                          <PriceCell date={t.entryDate} value={t.entryPrice} currency={m?.currency ?? null} fallback={<span className="text-sm text-kumo-subtle">Next close</span>} />
                        </KTableCell>
                        <KTableCell className="py-4 text-right">
                          {t.open ? (
                            <span className="flex flex-col items-end">
                              <Badge variant="outline">Open</Badge>
                              {t.markPrice !== null && (
                                <span className="text-sm text-kumo-subtle">
                                  {price(t.markPrice)} on {day(t.markDate!)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <PriceCell date={t.exitDate} value={t.exitPrice} currency={m?.currency ?? null} fallback={<span className="text-sm text-kumo-subtle">Next close</span>} />
                          )}
                        </KTableCell>
                        <KTableCell className="py-4 text-right">
                          <Pct value={t.return} />
                        </KTableCell>
                        <KTableCell className="py-4 pr-6 text-right font-mono tabular">{t.weight !== null ? `${(t.weight * 100).toFixed(1)}%` : empty}</KTableCell>
                      </KTableRow>
                    );
                  })}
                </KTableBody>
              </KTable>
            </div>
          )}
        </div>
      </TableSearch>
    </>
  );
}
