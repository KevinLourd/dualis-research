import { notFound } from "next/navigation";
import { AnalysisBody, analysisData, parseThesis } from "@/console/analysis";
import { itemView } from "@/console/item-detail";
import { SlideOver } from "@/console/slide-over";

/** The Analysis page (level B, full page) and, on `?item=`, one item's detail in a panel inside it (level C). */
export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ symbol: string }>; searchParams: Promise<{ item?: string; thesis?: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const { item, thesis: t } = await searchParams;
  const thesis = parseThesis(t);
  const [analysis, view] = await Promise.all([analysisData(symbol, thesis), item ? itemView(symbol, item, thesis) : null]);
  if (!analysis) notFound();
  const base = `/tickers/${encodeURIComponent(symbol)}`;
  return (
    <div className="flex max-w-4xl flex-col pt-6">
      <AnalysisBody analysis={analysis} variant="page" />
      {view && (
        <SlideOver title={view.title} subtitle={view.subtitle} closeHref={thesis ? `${base}?thesis=${thesis}` : base} size="lg" back>
          {view.body}
        </SlideOver>
      )}
    </div>
  );
}
