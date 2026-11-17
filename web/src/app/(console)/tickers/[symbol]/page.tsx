import { notFound } from "next/navigation";
import { AnalysisBody, analysisData, parseThesis } from "@/console/analysis";
import { itemView } from "@/console/item-detail";
import { ItemPanelHost } from "@/console/item-panel-host";

/** The Analysis page (level B, full page) and, on `?item=`, one item's detail in a panel inside it (level C). */
export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ item?: string; thesis?: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const { item, thesis: t } = await searchParams;
  const thesis = parseThesis(t);
  const [analysis, view] = await Promise.all([analysisData(symbol, thesis, true), item ? itemView(symbol, item, thesis) : null]);
  if (!analysis) notFound();
  const base = `/tickers/${encodeURIComponent(symbol)}`;
  return (
    <div className="flex max-w-4xl flex-col pt-6">
      <AnalysisBody analysis={analysis} variant="page" />
      {/* Level C: later panels load alone through item-nav.ts, never this whole page again (Workers CPU, 2026-11-17). */}
      <ItemPanelHost
        symbol={symbol}
        base={base}
        shown={analysis.objects.side}
        competing={analysis.objects.theses.length > 1}
        initial={item ? { item, thesis: t ?? null, view: view && { title: view.title, subtitle: view.subtitle ?? null, body: view.body } } : null}
      />
    </div>
  );
}
