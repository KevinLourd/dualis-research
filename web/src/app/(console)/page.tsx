import { LightningIcon } from "@phosphor-icons/react/ssr";
import { AnalysisBody, analysisData, analysisTitle } from "@/console/analysis";
import { InactiveTable, SignalTable } from "@/console/board";
import { inactiveBoard, signalBoard } from "@/console/board-queries";
import { BoardTabs } from "@/console/board-tabs";
import { SlideOver } from "@/console/slide-over";
import { ComingNext, PageHeader } from "@/console/ui";

export const metadata = { title: "Signals" };

/**
 * Level A: which ticker has a signal, in one glance. Strong signals on top; Weak and Noise in tabs below.
 * The portfolio is never here: it has its own page. A row opens its analysis in the right panel (`?ticker=`).
 */
export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; ticker?: string }> }) {
  const { tab: tabParam, ticker } = await searchParams;
  const tab = tabParam === "noise" || tabParam === "inactive" ? tabParam : "weak";
  const [rows, inactive, analysis] = await Promise.all([signalBoard(), inactiveBoard(), ticker ? analysisData(ticker) : null]);
  const strong = rows.filter((r) => r.strength === "strong");
  const weak = rows.filter((r) => r.strength === "weak");
  const noise = rows.filter((r) => r.strength === "noise");
  const base = tab === "weak" ? "/" : `/?tab=${tab}`;
  const panelHref = (symbol: string) => `${base}${base.includes("?") ? "&" : "?"}ticker=${encodeURIComponent(symbol)}`;
  const below = tab === "noise" ? noise : tab === "inactive" ? inactive : weak;

  return (
    <>
      <PageHeader title="Signals" description="Where the market's story on a stock is cracking or turning, strongest first. Open a row to see why." />
      {strong.length === 0 ? (
        <ComingNext
          icon={<LightningIcon size={40} className="text-kumo-inactive" />}
          title="No strong signal today"
          description="A strong signal is a narrative the judge sees cracking, with the price on the right side of your fair value. Weaker ones are below."
        />
      ) : (
        <SignalTable rows={strong} panelHref={panelHref} />
      )}
      <div className="flex flex-col gap-4 pt-6">
        <BoardTabs value={tab} weak={weak.length} noise={noise.length} inactive={inactive.length} />
        {below.length === 0 ? (
          <p className="text-base text-kumo-subtle">{tab === "weak" ? "No weak signal." : tab === "noise" ? "No ticker without a signal." : "Every watchlist ticker is analysed."}</p>
        ) : tab === "inactive" ? (
          <InactiveTable rows={below} />
        ) : (
          <SignalTable rows={below} panelHref={panelHref} />
        )}
      </div>
      {analysis && (
        <SlideOver title={analysisTitle(analysis.row)} subtitle={analysis.row.symbol} closeHref={base} size="lg">
          <AnalysisBody analysis={analysis} variant="panel" />
        </SlideOver>
      )}
    </>
  );
}
