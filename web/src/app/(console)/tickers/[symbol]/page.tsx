import { notFound } from "next/navigation";
import { AnalysisBody, analysisData } from "@/console/analysis";
import { itemView } from "@/console/item-detail";
import { SlideOver } from "@/console/slide-over";

/** The Analysis page (level B, full page) and, on `?item=`, one item's detail in a panel inside it (level C). */
export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ item?: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const { item } = await searchParams;
  const [analysis, view] = await Promise.all([analysisData(symbol), item ? itemView(symbol, item) : null]);
  if (!analysis) notFound();
  return (
    <div className="flex max-w-4xl flex-col pt-6">
      <AnalysisBody analysis={analysis} variant="page" />
      {view && (
        <SlideOver title={view.title} subtitle={view.subtitle} closeHref={`/tickers/${encodeURIComponent(symbol)}`} size="lg">
          {view.body}
        </SlideOver>
      )}
    </div>
  );
}
