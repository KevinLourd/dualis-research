import { Badge, Button, Input } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, CaretRightIcon, ChartLineIcon, FileTextIcon, QuestionIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { evidenceStrength } from "@/content/signal-words";
import type { GoldEvidence, GoldExhibit } from "@/db/schema/analysis";
import type { GoldCatalyst } from "@/db/schema/catalysts";
import type { GoldConsensus } from "@/db/schema/consensus";
import { type DriverWithExhibits, getTickerAnalysis, getValuation } from "./analysis-queries";
import { MethodsTable, ValuationField } from "./valuation-ui";
import { ArticleBody } from "./article";
import { type BoardRow, boardRowOf, priceVsFairValue } from "./board-queries";
import { CallBadge, FairValue, QuoteGap, StrengthBadge, TickerTag } from "./board";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "./kumo";
import { RowLink } from "./row-link";
import { signalWordsOf } from "./signal-history";
import { ExhibitChart } from "./driver-chart";
import { NewsTable, type NewsRow } from "./news-table";
import { PriceFairValueChart } from "./price-fair-chart";
import { TagBadge } from "./tag-badge";
import { EditableText } from "./editable-text";
import { day, price, relativeTime, utc } from "./format";
import { consensusOf, getTicker } from "./queries";
import { Section, StateBadge, StateChange } from "./signal";
import { getWhy } from "./signal-queries";
import { saveFairValue } from "./thesis-actions";
import { ComingNext } from "./ui";

/**
 * Level B: one ticker's analysis. The SAME content renders in the right panel (`variant="panel"`, from a Signals row)
 * and as the full Analysis page (`/tickers/[symbol]`). Every item (a figure, a news) opens level C: a panel inside
 * the Analysis page (`?item=`) with its detail and sources.
 */

export const itemHref = (symbol: string, item: string) => `/tickers/${encodeURIComponent(symbol)}?item=${encodeURIComponent(item)}`;

export async function analysisData(symbol: string) {
  const [row, data, why, consensus, objects, chart, valuation] = await Promise.all([
    boardRowOf(symbol),
    getTicker(symbol),
    getWhy(symbol),
    consensusOf(symbol),
    getTickerAnalysis(symbol),
    priceVsFairValue(symbol),
    getValuation(symbol),
  ]);
  if (!row || !data) return null;
  return { row, data, why, consensus, objects, chart, valuation };
}
type Analysis = NonNullable<Awaited<ReturnType<typeof analysisData>>>;

/** quote / fair value - 1 as the board row holds it (negative = below fair value), or null. */
export const gapPctOf = (row: Pick<BoardRow, "gap">) => (row.gap ? (row.gap.side === "below" ? -row.gap.pct : row.gap.pct) : null);

/** A's facts, each figure opening its own detail: those cards carry a caret and a stronger ring, so they read as buttons. */
function Facts({ row, wide, range }: { row: BoardRow; wide: boolean; range: { low: number; high: number } | null }) {
  const cell = "flex flex-col gap-1.5 rounded-lg px-4 py-3 ring-1 ring-kumo-hairline";
  const clickable = "group relative flex flex-col gap-1.5 rounded-lg px-4 py-3 pr-10 ring-1 ring-kumo-line shadow-xs transition-colors hover:bg-kumo-tint hover:ring-kumo-brand";
  const caret = <CaretRightIcon size={16} weight="bold" aria-hidden className="absolute top-1/2 right-3 -translate-y-1/2 text-kumo-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-kumo-link" />;
  return (
    <div className={`grid grid-cols-2 gap-3 ${wide ? "sm:grid-cols-4" : ""}`}>
      <div className={cell}>
        <span className="text-sm text-kumo-subtle">Signal</span>
        <span><CallBadge call={row.call} /></span>
      </div>
      <div className={cell}>
        <span className="text-sm text-kumo-subtle">Strength</span>
        <span><TickerTag row={row} /></span>
      </div>
      {/* The number only: how it was computed opens in its own panel (Kevin 2026-11-05). */}
      <Link href={itemHref(row.symbol, "fair-value")} scroll={false} className={clickable} title="How the fair value was computed">
        <span className="text-sm text-kumo-subtle">Fair value</span>
        <span><FairValue row={row} /></span>
        {range && (
          <span className="font-mono text-sm tabular text-kumo-default">
            Range {price(range.low)} to {price(range.high)}
          </span>
        )}
        {caret}
      </Link>
      <Link href={itemHref(row.symbol, "price")} scroll={false} className={clickable} title="Price history and sources">
        <span className="text-sm text-kumo-subtle">Quote</span>
        <span><QuoteGap row={row} align="left" /></span>
        {caret}
      </Link>
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
    v === null ? "–" : metric === "eps" ? v.toFixed(2) : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return (
    <div className="rounded-lg ring-1 ring-kumo-hairline">
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
    <div className="rounded-lg ring-1 ring-kumo-hairline">
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

/** News and filings judged against the narrative, each with its strength; a click opens the item with its sources. */
function Evidence({ symbol, rows }: { symbol: string; rows: GoldCatalyst[] }) {
  if (rows.length === 0) return <p className="text-lg text-kumo-subtle">No news or filing has been judged against the narrative yet.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={itemHref(symbol, `news:${c.id}`)} scroll={false} className="-mx-3 flex flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-kumo-tint">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-kumo-subtle">
              <StrengthBadge strength={evidenceStrength(c.direction, c.probability)} />
              <span>{c.direction === "contradicts" ? "Cracks the narrative" : "Continues the narrative"}</span>
              <span className="tabular">{day(c.eventDay)}</span>
              {c.publisher && <span>{c.publisher}</span>}
            </span>
            <span className="text-base font-medium text-kumo-strong">{c.headline}</span>
          </Link>
        </li>
      ))}
    </ol>
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
export function EvidenceRows({ symbol, rows, driverId, gapPct }: { symbol: string; rows: GoldEvidence[]; driverId: string; gapPct: number | null }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((e) => {
        const v = e.verdicts.find((x) => x.driverId === driverId);
        return (
        <li key={e.id}>
          <Link href={itemHref(symbol, `news:${e.id}`)} scroll={false} className="-mx-3 flex flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-kumo-tint">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-kumo-subtle">
              {v && <TagBadge effect={v.effect} strength={v.strength} gapPct={gapPct} />}
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

/** Narrative Drivers at a glance: category, the driver's tag, how many news bear on it, title. Text, exhibits and news open in the driver's panel. */
function Drivers({ symbol, drivers, gapPct }: { symbol: string; drivers: DriverWithExhibits[]; gapPct: number | null }) {
  return (
    <ol className="flex flex-col divide-y divide-kumo-hairline rounded-lg ring-1 ring-kumo-hairline">
      {drivers.map((d) => {
        return (
          <li key={d.id}>
            <Link href={itemHref(symbol, `driver:${d.id}`)} scroll={false} className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-kumo-tint">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{d.category}</Badge>
                {d.state && <TagBadge effect={d.state.effect} strength={d.state.strength} gapPct={gapPct} />}
                {d.evidence.length > 0 && <span className="text-sm text-kumo-subtle">{d.evidence.length} news</span>}
              </span>
              <span className="text-lg font-semibold text-kumo-strong">{d.title}</span>
              {d.summary && <span className="max-w-prose text-base text-kumo-default">{d.summary}</span>}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function AnalysisBody({ analysis, variant }: { analysis: Analysis; variant: "panel" | "page" }) {
  const { row, data, why, consensus, objects, chart, valuation } = analysis;
  const exhibitByNumber = new Map(objects.drivers.flatMap((d) => d.exhibits).map((x) => [x.number, x]));
  const { thesis, latest, state, evidence } = why;
  const symbol = row.symbol;
  // Thierry's own words win; else the analysis' narrative; else the first thesis draft.
  const own = thesis?.narrative && (thesis.narrativeState === "edited" || thesis.narrativeState === "thierry") ? thesis.narrative : null;
  const narrative = own ?? objects.narrative?.text ?? thesis?.narrative ?? null;
  const position = data.ticker.position;
  const gapPct = gapPctOf(row);
  const gap = variant === "page" ? "gap-14" : "gap-10";
  return (
    <div className={`flex flex-col ${gap}`}>
      {variant === "panel" && (
        <Link href={`/tickers/${encodeURIComponent(symbol)}`} className="inline-flex items-center gap-2 self-start text-sm font-medium text-kumo-link hover:underline">
          <ArrowSquareOutIcon size={16} aria-hidden /> Open the full analysis
        </Link>
      )}
      <Facts row={row} wide={variant === "page"} range={objects.fairValue?.low != null && objects.fairValue?.high != null ? { low: objects.fairValue.low, high: objects.fairValue.high } : null} />

      {chart.bars.length > 0 && (
        <PriceFairValueChart symbol={symbol} bars={chart.bars} fair={chart.fair} currency={chart.fair?.currency ?? row.currency} sources={chart.sources} />
      )}

      <Section title="Narrative">
        {narrative ? (
          // Plain text that turns into a same-size textarea on click, autosaved as Thierry's own version.
          <>
            <EditableText symbol={symbol} field="narrative" value={narrative} label="Narrative" className={`max-w-prose leading-snug text-kumo-strong ${variant === "page" ? "text-2xl" : "text-xl"}`} />
            {(objects.narrative?.detail || objects.rationale) && (
              <Link href={itemHref(symbol, "narrative")} scroll={false} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-kumo-link hover:underline">
                <QuestionIcon size={16} aria-hidden /> Why
              </Link>
            )}
          </>
        ) : (
          <p className="text-lg text-kumo-subtle">Not drafted yet. The next morning run drafts it for you to edit.</p>
        )}
        {objects.narrativeState ? (
          <div className="flex flex-col gap-2">
            <TagBadge effect={objects.narrativeState.effect} strength={objects.narrativeState.strength} gapPct={gapPct} />
            {objects.narrativeState.why && <p className="max-w-prose text-base leading-relaxed text-kumo-default">{objects.narrativeState.why}</p>}
          </div>
        ) : objects.signal ? null : latest ? (
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-3">
              <StateChange from={latest.fromState} to={latest.toState} position={position} />
              <time dateTime={latest.at.toISOString()} title={utc(latest.at)} className="text-sm text-kumo-subtle">
                {relativeTime(latest.at)}
              </time>
            </span>
            {latest.reason && <p className="max-w-prose text-base leading-relaxed text-kumo-default">{latest.reason}</p>}
          </div>
        ) : (
          state && (
            <div className="flex flex-col gap-2">
              <StateBadge state={state.state} position={position} />
              {state.reason && <p className="max-w-prose text-base leading-relaxed text-kumo-subtle">{state.reason}</p>}
            </div>
          )
        )}
      </Section>

      <Section title="Narrative drivers">
        {objects.drivers.length > 0 ? (
          <Drivers symbol={symbol} drivers={objects.drivers} gapPct={gapPct} />
        ) : (
          <ComingNext
            size="sm"
            icon={<ChartLineIcon size={28} className="text-kumo-inactive" />}
            title="No driver yet"
            description="Up to five drivers per ticker, each in its category with charts of reported data. The news that cracks or turns each driver will sit under it."
          />
        )}
      </Section>

      {objects.drivers.length === 0 && (
        <Section title={`News against the narrative · ${evidence.length}`}>
          <Evidence symbol={symbol} rows={evidence} />
        </Section>
      )}

      {variant === "page" && (
        <>
          <Section title="KPIs vs consensus">
            <Kpis symbol={symbol} rows={consensus} />
          </Section>
          {objects.signalChanges.length > 0 && (
            <Section title="Signal history">
              <SignalHistory changes={objects.signalChanges} />
            </Section>
          )}
          {valuation.methods.length > 0 && (
            <Section title="Valuation">
              {valuation.report && <p className="max-w-prose text-lg leading-relaxed text-kumo-strong">{valuation.report.summary}</p>}
              <ValuationField v={valuation} />
              <MethodsTable symbol={symbol} v={valuation} />
            </Section>
          )}
          {objects.drivers.length > 0 && objects.evidence.length > 0 && (
            <Section title={`News · ${objects.evidence.length}`}>
              <NewsTable rows={newsRows(symbol, objects)} drivers={objects.drivers.map((d) => ({ rank: d.rank, title: d.title }))} gapPct={gapPct} />
            </Section>
          )}
          <Section title="Your fair value">
            <form action={saveFairValue.bind(null, symbol, thesis?.currency ?? row.currency)} className="flex flex-wrap items-end gap-3">
              <Input name="value" label={`Fair value per share${row.currency ? ` (${row.currency})` : ""}`} inputMode="decimal" defaultValue={thesis?.fairValue ?? ""} className="w-40" />
              <Input name="basis" label="How you got it" placeholder="10x EV/EBITDA on 2027 EBITDA" defaultValue={thesis?.fairValueBasis ?? ""} className="w-80" />
              <Button type="submit" variant="secondary">Save</Button>
            </form>
            {thesis?.fairValueBasis && <p className="text-base text-kumo-subtle">{thesis.fairValueBasis}</p>}
          </Section>
          <Section title="Research report">
            {objects.report ? (
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
            ) : (
              <ComingNext
                size="sm"
                icon={<FileTextIcon size={28} className="text-kumo-inactive" />}
                title="No report yet"
                description="An equity research report on the company: business, five years of reported numbers, the narrative and your fair value."
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** The News table's rows: importance = the strongest tag the item carries on any driver. */
function newsRows(symbol: string, objects: Analysis["objects"]): NewsRow[] {
  return objects.evidence.map((e) => ({
    id: e.id,
    href: itemHref(symbol, `news:${e.id}`),
    day: day(e.eventDay),
    headline: e.headline,
    publisher: e.publisher,
    strength: e.effect === "too-old" ? "too-old" : e.strength,
    tags: objects.drivers.map((d) => {
      if (e.effect === "too-old") return { effect: "too-old", strength: "noise" };
      const v = e.verdicts.find((x) => x.driverId === d.id);
      return v ? { effect: v.effect, strength: v.strength } : null;
    }),
  }));
}

/** Title of the panel / page: the company and its ticker. */
export function analysisTitle(row: BoardRow) {
  return row.name ?? row.symbol;
}
