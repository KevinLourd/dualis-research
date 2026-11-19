import { ArrowSquareOutIcon, CaretRightIcon, ChartLineIcon, ClockCounterClockwiseIcon, FileTextIcon, ListBulletsIcon, NewspaperIcon, ScalesIcon, TargetIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import type { GoldEvidence, GoldExhibit, ThesisSide } from "@/db/schema/analysis";
import type { GoldConsensus } from "@/db/schema/consensus";
import { type DriverWithExhibits, getTickerAnalysis, getValuation, priceMoveMarkers } from "./analysis-queries";
import { MethodsTable, ValuationField } from "./valuation-ui";
import { ArticleBody } from "./article";
import { type BoardRow, boardRowOf, priceVsFairValue } from "./board-queries";
import { CallBadge, TickerTag } from "./board";
import { Drawer, Drawers } from "./drawer";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "./kumo";
import { RowLink } from "./row-link";
import { signalWordsOf } from "./signal-history";
import { ExhibitChart } from "./driver-chart";
import { NewsTable, type NewsRow } from "./news-table";
import { PriceFairValueChart } from "./price-fair-chart";
import { TagBadge } from "./tag-badge";
import { day, numberFormat, utc } from "./format";
import { consensusOf, getTicker } from "./queries";
import { Section } from "./signal";
import { getThesis } from "./thesis-queries";
import { ComingNext } from "./ui";
import { PRICED_WORD } from "@/content/signal-words";

/**
 * Level B: one ticker's analysis. The SAME content renders in the right panel (`variant="panel"`, from a Signals row)
 * and as the full Analysis page (`/tickers/[symbol]`). Every item (a figure, a news) opens level C: a panel inside
 * the Analysis page (`?item=`) with its detail and sources.
 */

/** An item of the Analysis page; `thesis` keeps the shown thesis behind the item's panel. */
export const itemHref = (symbol: string, item: string, thesis?: ThesisSide | null) => `/tickers/${encodeURIComponent(symbol)}?item=${encodeURIComponent(item)}${thesis ? `&thesis=${thesis}` : ""}`;

export const parseThesis = (v: string | undefined): ThesisSide | null => (v === "long" || v === "short" ? v : null);

export async function analysisData(symbol: string, thesis: ThesisSide | null = null, page = false) {
  const [row, data, ownFair, consensus, objects, chart, valuation, moves] = await Promise.all([
    boardRowOf(symbol),
    getTicker(symbol),
    getThesis(symbol),
    consensusOf(symbol),
    getTickerAnalysis(symbol, thesis),
    priceVsFairValue(symbol),
    getValuation(symbol),
    // The significant moves' markers sit on the Analysis page's chart only (the Signals panel stays light).
    page ? priceMoveMarkers(symbol) : [],
  ]);
  if (!row || !data) return null;
  return { row, data, ownFair, consensus, objects, chart, valuation, moves };
}
type Analysis = NonNullable<Awaited<ReturnType<typeof analysisData>>>;


/** The verdict in one line (Kevin 2026-11-18: the fair value and quote cards repeated the chart under them). */
function Verdict({ row }: { row: BoardRow }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CallBadge call={row.call} />
      <TickerTag row={row} />
    </div>
  );
}

const METRIC: Record<string, string> = { revenue: "Revenue", ebitda: "EBITDA", "operating-income": "Operating income", "net-income": "Net income", eps: "EPS" };
export const metricLabel = (m: string) => METRIC[m] ?? m;

/** KPIs vs consensus (Analysis page only): the latest period with a consensus per metric, one table row each; a row opens every period. */
function Kpis({ symbol, rows }: { symbol: string; rows: GoldConsensus[] }) {
  const latest = new Map<string, GoldConsensus>();
  for (const r of rows) if (r.mean !== null && !latest.has(r.metric)) latest.set(r.metric, r);
  if (latest.size === 0) return <p className="text-lg text-kumo-subtle">No free source publishes analyst estimates for this ticker.</p>;
  const fmt = (metric: string, v: number | null) =>
    v === null ? "–" : metric === "eps" ? v.toFixed(2) : numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(v);
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
      <KTable>
        <KTableHeader>
          <KTableRow>
            <KTableHead className="pl-4">Metric</KTableHead>
            <KTableHead>Period</KTableHead>
            <KTableHead className="text-right">Consensus</KTableHead>
            <KTableHead className="text-right">Actual</KTableHead>
            <KTableHead className="text-right">vs consensus</KTableHead>
            <KTableHead className="w-10 pr-4" />
          </KTableRow>
        </KTableHeader>
        <KTableBody>
          {[...latest.values()].map((r) => {
            const vs = r.actual !== null && r.mean ? (r.actual - r.mean) / Math.abs(r.mean) : null;
            return (
              <RowLink key={r.metric} href={itemHref(symbol, `kpi:${r.metric}`)} label={`Open ${metricLabel(r.metric)} vs consensus`}>
                <KTableCell className="py-3 pl-4 font-medium text-kumo-strong">{metricLabel(r.metric)}</KTableCell>
                <KTableCell className="py-3 whitespace-nowrap text-kumo-subtle">{`${r.periodType === "year" ? "FY" : "Q"} ${r.periodEnd}`}</KTableCell>
                <KTableCell className="py-3 text-right font-mono tabular">{fmt(r.metric, r.mean)}</KTableCell>
                <KTableCell className="py-3 text-right font-mono tabular text-kumo-strong">{fmt(r.metric, r.actual)}</KTableCell>
                <KTableCell className={`py-3 text-right font-mono tabular ${vs === null ? "text-kumo-subtle" : vs >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>
                  {vs === null ? "Not reported yet" : `${vs >= 0 ? "+" : "-"}${Math.abs(vs * 100).toFixed(1)}%`}
                </KTableCell>
                <KTableCell className="py-3 pr-4 text-right">
                  <CaretRightIcon size={16} weight="bold" aria-hidden className="text-kumo-subtle" />
                </KTableCell>
              </RowLink>
            );
          })}
        </KTableBody>
      </KTable>
    </div>
  );
}

/** Signal history (Analysis page only): every change after the baseline, newest first, with its one-line note. */
function SignalHistory({ changes }: { changes: Analysis["objects"]["signalChanges"] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
      <KTable>
        <KTableHeader>
          <KTableRow>
            <KTableHead className="w-32 pl-4">Date</KTableHead>
            <KTableHead className="w-80">Signal</KTableHead>
            <KTableHead className="pr-4">Why</KTableHead>
          </KTableRow>
        </KTableHeader>
        <KTableBody>
          {changes.map((c) => (
            <KTableRow key={c.id}>
              <KTableCell className="py-3 pl-4 align-top whitespace-nowrap tabular text-kumo-subtle" title={utc(c.at)}>{day(c.at.toISOString().slice(0, 10))}</KTableCell>
              <KTableCell className="py-3 align-top text-kumo-default">
                {signalWordsOf(c.fromSignal, c.fromStrength)} <span className="text-kumo-subtle">→</span> <span className="font-medium text-kumo-strong">{signalWordsOf(c.toSignal, c.toStrength)}</span>
              </KTableCell>
              <KTableCell className="py-3 pr-4 align-top text-kumo-strong">{c.updateNote ?? "–"}</KTableCell>
            </KTableRow>
          ))}
        </KTableBody>
      </KTable>
    </div>
  );
}

/** One exhibit, its title opening the exhibit's own panel. */
export function Exhibit({ symbol, exhibit, linked = true }: { symbol: string; exhibit: GoldExhibit; linked?: boolean }) {
  const chart = <ExhibitChart number={exhibit.number} title={exhibit.title} chart={exhibit.chart} series={exhibit.series} points={exhibit.points} sources={exhibit.sources} />;
  if (!linked) return chart;
  return (
    <div className="flex flex-col gap-2">
      {chart}
      <Link href={itemHref(symbol, `exhibit:${exhibit.id}`)} scroll={false} className="self-start text-sm font-medium text-kumo-link hover:underline">
        {exhibit.takeaway}
      </Link>
    </div>
  );
}

/** News judged against ONE driver: its tag against that driver, the headline (opens its panel). */
export function EvidenceRows({ symbol, rows, driverId, side }: { symbol: string; rows: GoldEvidence[]; driverId: string; side: ThesisSide }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((e) => {
        const v = e.verdicts.find((x) => x.driverId === driverId);
        return (
        <li key={e.id}>
          <Link href={itemHref(symbol, `news:${e.id}`, side)} scroll={false} className="-mx-3 flex flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-kumo-tint">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-kumo-subtle">
              {v && <TagBadge effect={v.effect} strength={v.strength} side={side} />}
              {v?.pricedIn && v.effect !== "noise" && <span>{PRICED_WORD[v.pricedIn]}</span>}
              <span className="tabular">{day(e.eventDay)}</span>
              {e.publisher && <span>{e.publisher}</span>}
            </span>
            <span className="text-base font-medium text-kumo-strong">{e.headline}</span>
          </Link>
        </li>
        );
      })}
    </ol>
  );
}

export { PRICED_WORD };

const turning = (d: DriverWithExhibits) => d.state?.effect === "reversal" && d.state.strength !== "noise";

/** One driver: its category, its title, its tag. Text, exhibits and news open in the driver's panel. */
function DriverRow({ symbol, d, side, thesis }: { symbol: string; d: DriverWithExhibits; side: ThesisSide; thesis: ThesisSide | null }) {
  return (
    <li>
      <Link href={itemHref(symbol, `driver:${d.id}`, thesis)} scroll={false} className="-mx-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg px-3 py-3 transition-colors hover:bg-kumo-tint">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-kumo-subtle">{d.category}</span>
          <span className="text-lg font-semibold text-kumo-strong">{d.title}</span>
        </span>
        <span className="flex items-center gap-2">
          {d.state ? <TagBadge effect={d.state.effect} strength={d.state.strength} side={side} durability={d.state.durability} /> : <span className="text-sm text-kumo-subtle">Not judged yet</span>}
          <CaretRightIcon size={16} weight="bold" aria-hidden className="text-kumo-subtle" />
        </span>
      </Link>
    </li>
  );
}

/**
 * Narrative Drivers (Kevin 2026-11-18: « pourquoi tu les affiches si c'est du noise ou de la continuation ? »): only the
 * drivers that turn show, strongest first; the ones that hold or do not move sit in a closed drawer.
 */
export function Drivers({ symbol, drivers, side, thesis }: { symbol: string; drivers: DriverWithExhibits[]; side: ThesisSide; thesis: ThesisSide | null }) {
  const moving = drivers.filter(turning).sort((a, b) => Number(b.state!.strength === "strong") - Number(a.state!.strength === "strong") || a.rank - b.rank);
  const rest = drivers.filter((d) => !turning(d));
  const rows = (list: DriverWithExhibits[]) => (
    <ol className="flex flex-col">
      {list.map((d) => (
        <DriverRow key={d.id} symbol={symbol} d={d} side={side} thesis={thesis} />
      ))}
    </ol>
  );
  return (
    <div className="flex flex-col gap-2">
      {moving.length > 0 ? rows(moving) : <p className="text-lg text-kumo-subtle">No driver is turning.</p>}
      {rest.length > 0 && (
        <Drawers>
          <Drawer icon={<ListBulletsIcon size={16} aria-hidden />} title={moving.length > 0 ? `${rest.length} other ${rest.length === 1 ? "driver" : "drivers"}, not turning` : `${rest.length} ${rest.length === 1 ? "driver" : "drivers"}`}>{rows(rest)}</Drawer>
        </Drawers>
      )}
    </div>
  );
}

/**
 * One story on screen (Kevin 2026-11-09, « WTF IS THAT » on the two-thesis tabs): the thesis that signals, else the only
 * one, else the long. The competition between two theses stays in the backend.
 */
export function AnalysisBody({ analysis, variant }: { analysis: Analysis; variant: "panel" | "page" }) {
  const { row, consensus, objects, chart, valuation, moves } = analysis;
  const exhibitByNumber = new Map(objects.drivers.flatMap((d) => d.exhibits).map((x) => [x.number, x]));
  const symbol = row.symbol;
  // The analysis writes the narrative; nobody edits it by hand (Kevin 2026-11-09).
  const narrative = objects.narrative?.text ?? null;
  const side = objects.side;
  // Item links keep the shown thesis only when two compete (one thesis = the default).
  const keep = objects.theses.length > 1 ? side : null;
  const gap = variant === "page" ? "gap-14" : "gap-10";
  return (
    <div className={`flex flex-col ${gap}`}>
      {variant === "panel" && (
        <Link href={`/tickers/${encodeURIComponent(symbol)}`} className="inline-flex items-center gap-2 self-start text-sm font-medium text-kumo-link hover:underline">
          <ArrowSquareOutIcon size={16} aria-hidden /> Open the full analysis
        </Link>
      )}
      <Verdict row={row} />

      {chart.bars.length > 0 && (
        <PriceFairValueChart symbol={symbol} bars={chart.bars} fair={chart.fair} currency={chart.fair?.currency ?? row.currency} sources={chart.sources} moves={variant === "page" ? moves : []} priceHref={itemHref(symbol, "price")} fairHref={chart.fair ? itemHref(symbol, "fair-value") : null} />
      )}

      <Section title="Narrative">
        {narrative ? (
          <>
            <p className={`max-w-prose leading-snug text-kumo-strong ${variant === "page" ? "text-2xl" : "text-xl"}`}>{narrative}</p>
            <Link href={itemHref(symbol, "narrative", keep)} scroll={false} className="inline-flex items-center gap-1 self-start text-sm font-medium text-kumo-link hover:underline">
              Why <CaretRightIcon size={14} weight="bold" aria-hidden />
            </Link>
          </>
        ) : (
          <p className="text-lg text-kumo-subtle">Not drafted yet.</p>
        )}
      </Section>

      <Section title="Narrative drivers">
        {objects.drivers.length > 0 && side ? (
          <Drivers symbol={symbol} drivers={objects.drivers} side={side} thesis={keep} />
        ) : (
          <ComingNext
            size="sm"
            icon={<ChartLineIcon size={28} className="text-kumo-inactive" />}
            title="No driver yet"
            description="The next run writes them."
          />
        )}
      </Section>

      {variant === "page" && (
        <Drawers>
          <Drawer icon={<TargetIcon size={16} aria-hidden />} title="KPIs vs consensus">
            <Kpis symbol={symbol} rows={consensus} />
          </Drawer>
          {objects.signalChanges.length > 0 && (
            <Drawer icon={<ClockCounterClockwiseIcon size={16} aria-hidden />} title={`Signal history · ${objects.signalChanges.length}`}>
              <SignalHistory changes={objects.signalChanges} />
            </Drawer>
          )}
          {valuation.methods.length > 0 && (
            <Drawer icon={<ScalesIcon size={16} aria-hidden />} title="Valuation">
              <ValuationField v={valuation} />
              <MethodsTable symbol={symbol} v={valuation} />
            </Drawer>
          )}
          {objects.drivers.length > 0 && objects.evidence.length > 0 && (
            <Drawer icon={<NewspaperIcon size={16} aria-hidden />} title={`News · ${objects.evidence.length}`}>
              <NewsTable rows={newsRows(symbol, objects, keep)} drivers={objects.drivers.map((d) => ({ rank: d.rank, title: d.title }))} side={side} />
            </Drawer>
          )}
          {objects.report && (
            <Drawer icon={<FileTextIcon size={16} aria-hidden />} title="Research report">
              <article className="flex max-w-3xl flex-col gap-4">
                <h3 className="text-2xl font-bold text-kumo-strong">{objects.report.title}</h3>
                <ArticleBody
                  markdown={objects.report.markdown}
                  renderExhibit={(n) => {
                    const x = exhibitByNumber.get(n);
                    return x ? <Exhibit symbol={symbol} exhibit={x} /> : null;
                  }}
                />
              </article>
            </Drawer>
          )}
        </Drawers>
      )}
    </div>
  );
}

/** The News table's rows for the shown thesis: importance = the strongest tag the item carries on one of its drivers. */
function newsRows(symbol: string, objects: Analysis["objects"], keep: ThesisSide | null): NewsRow[] {
  const ids = new Set(objects.drivers.map((d) => d.id));
  return objects.evidence.map((e) => {
    const mine = e.verdicts.filter((v) => ids.has(v.driverId));
    const top = mine.some((v) => v.strength === "strong") ? "strong" : mine.some((v) => v.strength === "weak") ? "weak" : "noise";
    return {
      id: e.id,
      href: itemHref(symbol, `news:${e.id}`, keep),
      day: day(e.eventDay),
      headline: e.headline,
      publisher: e.publisher,
      strength: e.effect === "too-old" || (mine.length === 0 && e.verdicts.length > 0) ? "too-old" : top,
      tags: objects.drivers.map((d) => {
        if (e.effect === "too-old") return { effect: "too-old", strength: "noise" };
        const v = e.verdicts.find((x) => x.driverId === d.id);
        return v ? { effect: v.effect, strength: v.strength } : null;
      }),
    };
  });
}

/** Title of the panel / page: the company and its ticker. */
export function analysisTitle(row: BoardRow) {
  return row.name ?? row.symbol;
}
