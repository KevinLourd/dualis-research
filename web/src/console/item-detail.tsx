import { ArrowSquareOutIcon } from "@phosphor-icons/react/ssr";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { Badge } from "@cloudflare/kumo";
import Link from "@/console/link";
import { getTickerAnalysis, getValuation } from "./analysis-queries";
import { ArticleBody } from "./article";
import { MethodsTable, RangeCards, ValuationField } from "./valuation-ui";
import { driverDetail, evidenceDetail, exhibitDetail, fairValueDetail, kpiDetail, priceDetail } from "./board-queries";
import { StrengthBadge } from "./board";
import { TagBadge } from "./tag-badge";
import { EvidenceRows, Exhibit, itemHref, metricLabel } from "./analysis";
import { DriverExhibit, ExhibitChart } from "./driver-chart";
import { formatUnit } from "./exhibit-format";
import { day, price, utc } from "./format";
import { Section } from "./signal";
import { Fact, FactList, SourceTags } from "./ui";

/**
 * Level C: the detail of one item of the analysis (`?item=` on the Analysis page): what it says, its chart, and where
 * it comes from (gold row, silver key, every source tag, the original document).
 * Items: `fair-value`, `narrative` (its detail + Rationale), `news:<catalyst id>` (= its Evidence id), `driver:<id>`, `exhibit:<id>`, `kpi:<metric>`, `price`.
 */

export type ItemView = { title: string; subtitle?: string; body: React.ReactNode };

function Provenance({ gold, silver, sources }: { gold: string; silver: string; sources: string[] }) {
  return (
    <Section title="Sources">
      <div className="rounded-lg ring-1 ring-kumo-hairline">
        <FactList>
          <Fact label="Gold">
            <span className="font-mono text-[12px] break-all">{gold}</span>
          </Fact>
          <Fact label="Silver">
            <span className="font-mono text-[12px] break-all">{silver}</span>
          </Fact>
          <Fact label="Bronze">
            <SourceTags sources={sources} />
          </Fact>
        </FactList>
      </div>
    </Section>
  );
}

const external = "inline-flex items-start gap-1.5 text-base font-medium text-kumo-strong hover:text-kumo-link";

async function newsItem(symbol: string, id: string): Promise<ItemView | null> {
  const d = await evidenceDetail(symbol, id);
  if (!d) return null;
  const { catalyst: c } = d;
  return {
    title: c.headline,
    subtitle: `${day(c.eventDay)}${c.publisher ? ` · ${c.publisher}` : ""}`,
    body: (
      <>
        {d.evidence ? (
          // Judged against EACH driver (Kevin 2026-11-06): one tag per driver, why, and the sentence it rests on.
          <ul className="flex flex-col divide-y divide-kumo-hairline rounded-lg ring-1 ring-kumo-hairline">
            {d.drivers.map((drv) => {
              const v = d.evidence!.verdicts.find((x) => x.driverId === drv.id);
              return (
                <li key={drv.id} className="flex flex-col gap-2 px-4 py-3.5">
                  <span className="flex flex-wrap items-center gap-2">
                    {v ? <TagBadge effect={v.effect} strength={v.strength} gapPct={d.gapPct} /> : <span className="text-sm text-kumo-subtle">Not judged yet</span>}
                    <Link href={itemHref(symbol, `driver:${drv.id}`)} scroll={false} className="text-base font-medium text-kumo-link hover:underline">
                      {drv.title}
                    </Link>
                  </span>
                  {v?.why && <p className="text-base leading-relaxed text-kumo-strong">{v.why}</p>}
                  {v?.citedSentence && v.effect !== "noise" && (
                    <blockquote className="border-l border-kumo-line pl-4 text-sm leading-relaxed text-kumo-default italic">“{v.citedSentence}”</blockquote>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StrengthBadge strength={d.strength} />
              <span className="text-base text-kumo-default">{c.direction === "contradicts" ? "Cracks the narrative" : "Continues the narrative"}</span>
              <span className="text-sm text-kumo-subtle tabular">judge {Math.round(c.probability * 100)}% sure</span>
            </div>
            {c.reason && <p className="text-lg leading-relaxed text-kumo-strong">{c.reason}</p>}
            {c.evidence && <blockquote className="border-l border-kumo-line pl-4 text-base leading-relaxed text-kumo-default italic">“{c.evidence}”</blockquote>}
          </>
        )}
        {d.exhibit && <Exhibit symbol={symbol} exhibit={d.exhibit} />}
        <Section title="Original documents">
          <ul className="flex flex-col gap-4">
            {d.articles.map((a) => (
              <li key={a.id} className="flex flex-col gap-1">
                <a href={a.url} target="_blank" rel="noreferrer" className={external}>
                  {a.title} <ArrowSquareOutIcon size={14} className="mt-1 shrink-0" aria-label="opens the article" />
                </a>
                <span className="flex flex-wrap items-center gap-2 text-sm text-kumo-subtle">
                  {a.publisher && <span>{a.publisher}</span>}
                  {a.publishedAt && <time title={utc(a.publishedAt)}>{day(a.publishedAt)}</time>}
                  <SourceTags sources={a.sources} />
                </span>
              </li>
            ))}
            {d.filings.map((f) => (
              <li key={f.id} className="flex flex-col gap-1">
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className={external}>
                    {f.title} <ArrowSquareOutIcon size={14} className="mt-1 shrink-0" aria-label="opens the filing" />
                  </a>
                ) : (
                  <span className="text-base font-medium text-kumo-strong">{f.title}</span>
                )}
                <span className="flex flex-wrap items-center gap-2 text-sm text-kumo-subtle">
                  <span>{[f.registry, f.form].filter(Boolean).join(" ")}</span>
                  <time title={utc(f.filedAt)}>{day(f.filedAt)}</time>
                  <SourceTags sources={f.sources} />
                </span>
              </li>
            ))}
            {d.articles.length + d.filings.length === 0 && <li className="text-base text-kumo-subtle">No document is linked to this item any more.</li>}
          </ul>
        </Section>
        <Provenance
          gold={d.evidence ? `gold.evidence ${c.id} (judged against ${d.evidence.driverId ?? "no driver"}), gold.catalysts ${c.id}` : `gold.catalysts ${c.id}`}
          silver={`silver.catalyst_events ${c.id} (${c.newsItemIds.length} article${c.newsItemIds.length === 1 ? "" : "s"}, ${c.filingIds.length} filing${c.filingIds.length === 1 ? "" : "s"}, judged against the narrative)`}
          sources={c.sources}
        />
      </>
    ),
  };
}

async function kpiItem(symbol: string, metric: string): Promise<ItemView | null> {
  const rows = await kpiDetail(symbol, metric);
  if (rows.length === 0) return null;
  const annual = rows.filter((r) => r.periodType === "year");
  const series = (annual.some((r) => r.actual !== null) ? annual : rows.filter((r) => r.periodType === "quarter")).filter((r) => r.actual !== null);
  const period = series[0]?.periodType === "year" ? "annual" : "quarterly";
  const fmt = (v: number | null) => (v === null ? "–" : metric === "eps" ? v.toFixed(2) : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v));
  const sources = [...new Set(rows.flatMap((r) => Object.values(r.provenance).flatMap((p) => p.sources)))];
  const currency = rows.find((r) => r.currency)?.currency ?? null;
  return {
    title: `${metricLabel(metric)} vs consensus`,
    subtitle: currency ? `In ${currency}` : undefined,
    body: (
      <>
        {series.length > 0 && (
          <DriverExhibit
            number={1}
            title={`${metricLabel(metric)}, reported`}
            unit={currency}
            period={period}
            points={series.map((r) => ({ date: `${r.periodEnd}-01`, value: r.actual! }))}
            sources={sources}
          />
        )}
        <div className="rounded-lg ring-1 ring-kumo-hairline">
          <KTable>
            <KTableHeader>
              <KTableRow>
                <KTableHead className="pl-4">Period</KTableHead>
                <KTableHead className="text-right">Low</KTableHead>
                <KTableHead className="text-right">Mean</KTableHead>
                <KTableHead className="text-right">High</KTableHead>
                <KTableHead className="pr-4 text-right">Actual</KTableHead>
              </KTableRow>
            </KTableHeader>
            <KTableBody>
              {[...rows].reverse().map((r) => (
                <KTableRow key={`${r.periodType}|${r.periodEnd}`}>
                  <KTableCell className="pl-4 whitespace-nowrap">{`${r.periodType === "year" ? "FY" : "Q"} ${r.periodEnd}`}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{fmt(r.low)}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{fmt(r.mean)}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{fmt(r.high)}</KTableCell>
                  <KTableCell className="pr-4 text-right font-mono tabular text-kumo-strong">{fmt(r.actual)}</KTableCell>
                </KTableRow>
              ))}
            </KTableBody>
          </KTable>
        </div>
        <Provenance gold={`gold.consensus ${symbol} · ${metric} (${rows.length} periods)`} silver={`silver.facts dimension consensus, subject ${symbol}|<period>|${metric}`} sources={sources} />
      </>
    ),
  };
}

async function priceItem(symbol: string): Promise<ItemView | null> {
  const bars = await priceDetail(symbol);
  const last = bars.at(-1);
  if (!last) return null;
  const sources = [...new Set(bars.flatMap((b) => b.sources))];
  const disagreements = bars.filter((b) => b.alternatives.length > 0).length;
  return {
    title: "Share price",
    subtitle: `Close of ${day(last.date)}: ${price(last.close)}`,
    body: (
      <>
        <DriverExhibit number={1} title={`${symbol} daily close`} unit={null} period="market" points={bars.map((b) => ({ date: b.date, value: b.close }))} sources={sources} />
        <p className="text-base text-kumo-subtle">
          {bars.length} trading days. {disagreements === 0 ? "Every source agrees on every close." : `${disagreements} day${disagreements === 1 ? "" : "s"} where a source's close differs by more than 0.5%.`}
        </p>
        <Provenance gold={`gold.price_bars ${symbol} (${bars.length} days), gold.quotes ${symbol}`} silver={`silver.price_bars ${symbol}: every source's bar per day`} sources={sources} />
      </>
    ),
  };
}

async function driverItem(symbol: string, id: string): Promise<ItemView | null> {
  const d = await driverDetail(symbol, id);
  if (!d) return null;
  const sources = [...new Set(d.exhibits.flatMap((x) => x.sources))];
  return {
    title: d.driver.title,
    subtitle: `${d.driver.category}, a reason the market holds the narrative`,
    body: (
      <>
        {d.state && (
          <div className="flex flex-col gap-2">
            <TagBadge effect={d.state.effect} strength={d.state.strength} gapPct={d.gapPct} />
            {d.state.why && <p className="text-base leading-relaxed text-kumo-default">{d.state.why}</p>}
          </div>
        )}
        <p className="text-lg leading-relaxed text-kumo-strong">{d.driver.text}</p>
        {d.exhibits.map((x) => (
          <Exhibit key={x.id} symbol={symbol} exhibit={x} />
        ))}
        <Section title={`News that bear on it · ${d.evidence.length}`}>
          {d.evidence.length ? <EvidenceRows symbol={symbol} rows={d.evidence} driverId={d.driver.id} gapPct={d.gapPct} /> : <p className="text-base text-kumo-subtle">No news has touched this driver yet.</p>}
        </Section>
        <Provenance gold={`gold.narrative_drivers ${d.driver.id}, gold.exhibits ${d.exhibits.map((x) => x.id).join(", ") || "none"}`} silver={`silver.analyses version ${d.driver.version} (Claude's analysis, figures read from gold)`} sources={sources} />
      </>
    ),
  };
}

async function exhibitItem(symbol: string, id: string): Promise<ItemView | null> {
  const d = await exhibitDetail(symbol, id);
  if (!d) return null;
  const x = d.exhibit;
  return {
    title: `Exhibit ${x.number}: ${x.title}`,
    subtitle: d.driver ? `${d.driver.category}: ${d.driver.title}` : undefined,
    body: (
      <>
        <ExhibitChart number={x.number} title={x.title} chart={x.chart} series={x.series} points={x.points} sources={x.sources} height={280} />
        <p className="text-lg leading-relaxed text-kumo-strong">{x.takeaway}</p>
        <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
          <KTable>
            <KTableHeader>
              <KTableRow>
                <KTableHead className="pl-4">Period</KTableHead>
                {x.series.map((s) => (
                  <KTableHead key={s.key} className="pr-4 text-right">
                    {s.label}
                  </KTableHead>
                ))}
              </KTableRow>
            </KTableHeader>
            <KTableBody>
              {[...x.points].reverse().map((p) => (
                <KTableRow key={p.period}>
                  <KTableCell className="pl-4 whitespace-nowrap">{p.period}</KTableCell>
                  {x.series.map((s) => (
                    <KTableCell key={s.key} className="pr-4 text-right font-mono tabular">
                      {p.values[s.key] === null || p.values[s.key] === undefined ? "–" : formatUnit(p.values[s.key]!, s.unit, s.currency)}
                    </KTableCell>
                  ))}
                </KTableRow>
              ))}
            </KTableBody>
          </KTable>
        </div>
        <Section title="Series">
          <ul className="flex flex-col gap-2">
            {x.series.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 text-base">
                <span className="text-kumo-strong">{s.label}</span>
                <span className="font-mono text-[12px] text-kumo-subtle">{s.key}</span>
                <SourceTags sources={s.sources} />
              </li>
            ))}
          </ul>
        </Section>
        <Provenance gold={`gold.exhibits ${x.id} (numbers read from gold at rebuild, never from the model)`} silver="silver.facts / financial lines behind each series key" sources={x.sources} />
      </>
    ),
  };
}

/** The Fair Value (level C): the range, the football field, every method (each opens its own panel), the Valuation Report. */
async function fairValueItem(symbol: string): Promise<ItemView | null> {
  const [f, v] = await Promise.all([fairValueDetail(symbol), getValuation(symbol)]);
  if (!f) return null;
  const r = v.report;
  return {
    title: `Fair value ${price(f.value)}${f.currency ? ` ${f.currency}` : ""}`,
    subtitle: f.author === "thierry" ? "Your number" : (r?.label ?? f.label ?? "Weighted from several valuation methods"),
    body: (
      <>
        {r && <RangeCards low={r.low} base={r.base} high={r.high} currency={r.currency} baseLabel={f.author === "thierry" ? "Weighted methods" : "Fair value"} />}
        {f.author === "thierry" && <p className="text-base text-kumo-default">Your number wins{f.method ? ` (${f.method})` : ""}. The methods below are Claude&apos;s, for reference.</p>}
        {r && <p className="text-lg leading-relaxed text-kumo-strong">{r.summary}</p>}
        <ValuationField v={v} />
        {v.methods.length > 0 && (
          <Section title="Methods">
            <MethodsTable symbol={symbol} v={v} />
          </Section>
        )}
        {r && (
          <Section title="Valuation report">
            <article className="flex max-w-3xl flex-col gap-4">
              <ArticleBody markdown={r.markdown} />
            </article>
          </Section>
        )}
        <Provenance
          gold={`gold.fair_values ${symbol} (${f.author === "thierry" ? "your console value wins" : "weighted methods"})${r ? `, gold.valuation_reports ${symbol}, gold.method_valuations ${symbol}:*` : ""}`}
          silver={r ? `silver.valuation_syntheses version ${r.version}; silver.method_valuations (one per method and input set)` : "silver.facts thesis fairValue (your console edit)"}
          sources={f.author === "thierry" ? ["console"] : ["claude", ...new Set(v.methods.flatMap((m) => m.inputs.flatMap((i) => i.sources)))]}
        />
      </>
    ),
  };
}

/** One Valuation Method on the ticker (level C): its range, assumptions with why, the calculation step by step, its chart, inputs and report. */
async function methodItem(symbol: string, method: string): Promise<ItemView | null> {
  const v = await getValuation(symbol);
  const m = v.methods.find((x) => x.method === method);
  if (!m) return null;
  const unit = (u: string, x: number) => formatUnit(x, u as "currency", u === "per-share" || u === "currency" ? m.currency : null);
  return {
    title: m.name,
    subtitle: `${m.family}: ${m.description}`,
    body: (
      <>
        {m.applicable && m.base !== null ? (
          <RangeCards low={m.low} base={m.base} high={m.high} currency={m.currency} baseLabel={`Base${m.weight ? `, weight ${Math.round(m.weight.weight * 100)}%` : ""}`} />
        ) : (
          <p className="text-lg text-kumo-subtle">Not used for this company: {m.reason}</p>
        )}
        {m.summary && <p className="text-lg leading-relaxed text-kumo-strong">{m.summary}</p>}
        {m.weight?.why && <p className="text-base text-kumo-default">Weight: {m.weight.why}</p>}
        {m.history && m.history.points.length > 1 && (
          <ExhibitChart
            number={1}
            title={m.history.label}
            chart="bar"
            series={[{ key: "h", label: m.history.label, unit: m.history.unit as "multiple", currency: m.currency, sources: [] }]}
            points={m.history.points.map((p) => ({ period: p.period, values: { h: p.value } }))}
            sources={[...new Set(m.inputs.flatMap((i) => i.sources))]}
          />
        )}
        {m.assumptions.length > 0 && (
          <Section title="Assumptions">
            <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
              <KTable>
                <KTableHeader>
                  <KTableRow>
                    <KTableHead className="pl-4">Assumption</KTableHead>
                    <KTableHead className="text-right">Low</KTableHead>
                    <KTableHead className="text-right">Base</KTableHead>
                    <KTableHead className="text-right">High</KTableHead>
                    <KTableHead className="pr-4">Why</KTableHead>
                  </KTableRow>
                </KTableHeader>
                <KTableBody>
                  {m.assumptions.map((a) => (
                    <KTableRow key={a.key}>
                      <KTableCell className="pl-4 align-top">{a.label}</KTableCell>
                      <KTableCell className="text-right align-top font-mono tabular">{unit(a.unit, a.low)}</KTableCell>
                      <KTableCell className="text-right align-top font-mono tabular text-kumo-strong">{unit(a.unit, a.base)}</KTableCell>
                      <KTableCell className="text-right align-top font-mono tabular">{unit(a.unit, a.high)}</KTableCell>
                      <KTableCell className="pr-4 align-top text-kumo-default">{a.why}</KTableCell>
                    </KTableRow>
                  ))}
                </KTableBody>
              </KTable>
            </div>
            {m.basis && <p className="text-sm text-kumo-subtle">Run on: {m.basis}</p>}
          </Section>
        )}
        {m.steps.length > 0 && (
          <Section title="Calculation">
            <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
              <KTable>
                <KTableHeader>
                  <KTableRow>
                    <KTableHead className="pl-4">Step</KTableHead>
                    <KTableHead className="text-right">Low</KTableHead>
                    <KTableHead className="text-right">Base</KTableHead>
                    <KTableHead className="pr-4 text-right">High</KTableHead>
                  </KTableRow>
                </KTableHeader>
                <KTableBody>
                  {m.steps.map((st) => (
                    <KTableRow key={st.label}>
                      <KTableCell className="pl-4">{st.label}</KTableCell>
                      <KTableCell className="text-right font-mono tabular">{unit(st.unit, st.low)}</KTableCell>
                      <KTableCell className="text-right font-mono tabular text-kumo-strong">{unit(st.unit, st.base)}</KTableCell>
                      <KTableCell className="pr-4 text-right font-mono tabular">{unit(st.unit, st.high)}</KTableCell>
                    </KTableRow>
                  ))}
                </KTableBody>
              </KTable>
            </div>
          </Section>
        )}
        {m.peers.length > 0 && (
          <Section title="Comparable companies">
            <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
              <KTable>
                <KTableHeader>
                  <KTableRow>
                    <KTableHead className="pl-4">Company</KTableHead>
                    <KTableHead className="text-right">EV/EBITDA</KTableHead>
                    <KTableHead className="pr-4 text-right">P/E</KTableHead>
                  </KTableRow>
                </KTableHeader>
                <KTableBody>
                  {m.peers.map((p) => (
                    <KTableRow key={p.symbol}>
                      <KTableCell className="pl-4">
                        {p.name ?? p.symbol} <span className="font-mono text-[12px] text-kumo-subtle">{p.symbol}</span>
                      </KTableCell>
                      <KTableCell className="text-right font-mono tabular">{p.evEbitda === null ? "–" : `${p.evEbitda.toFixed(1)}x`}</KTableCell>
                      <KTableCell className="pr-4 text-right font-mono tabular">{p.pe === null ? "–" : `${p.pe.toFixed(1)}x`}</KTableCell>
                    </KTableRow>
                  ))}
                </KTableBody>
              </KTable>
            </div>
          </Section>
        )}
        {m.inputs.length > 0 && (
          <Section title="Inputs">
            <div className="rounded-lg ring-1 ring-kumo-hairline">
              <FactList>
                {m.inputs.map((i) => (
                  <Fact key={i.key} label={i.label}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono tabular">{unit(i.unit, i.value)}</span>
                      <span className="text-sm text-kumo-subtle">{i.period}</span>
                      <SourceTags sources={i.sources} />
                    </span>
                  </Fact>
                ))}
              </FactList>
            </div>
          </Section>
        )}
        {m.report && (
          <Section title="Report">
            <article className="flex max-w-3xl flex-col gap-4">
              <ArticleBody markdown={m.report} />
            </article>
          </Section>
        )}
        <Provenance gold={`gold.method_valuations ${m.id}`} silver={`silver.method_valuations version ${m.version} (Claude picked the assumptions, the code did the arithmetic)`} sources={["claude", ...new Set(m.inputs.flatMap((i) => i.sources))]} />
      </>
    ),
  };
}

/** Why the market tells this story: the narrative's detail, then each claim of its Rationale with the drivers and sources it rests on. */
async function narrativeItem(symbol: string): Promise<ItemView | null> {
  const a = await getTickerAnalysis(symbol);
  if (!a.narrative) return null;
  const r = a.rationale;
  const driverByRank = new Map(a.drivers.map((d) => [d.rank, d]));
  const exhibitByNumber = new Map([...a.drivers.flatMap((d) => d.exhibits), ...(r?.exhibits ?? [])].map((x) => [String(x.number), x]));
  const sources = [...new Set((r?.exhibits ?? []).flatMap((x) => x.sources))];
  return {
    title: "Why the market tells this story",
    subtitle: a.narrative.text,
    body: (
      <>
        {a.narrative.detail && <p className="text-lg leading-relaxed text-kumo-strong">{a.narrative.detail}</p>}
        {r && (
          <Section title="Rationale">
            <p className="text-base leading-relaxed text-kumo-default">{r.summary}</p>
            <ol className="flex flex-col gap-5">
              {r.claims.map((c, i) => (
                <li key={i} className="flex flex-col gap-2">
                  <p className="text-base leading-relaxed text-kumo-strong">{c.text}</p>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {c.drivers.map((rank) => {
                      const d = driverByRank.get(rank);
                      return d ? (
                        <Link key={rank} href={itemHref(symbol, `driver:${d.id}`)} scroll={false} className="text-kumo-link hover:underline">
                          <Badge variant="outline">{d.category}</Badge> {d.title}
                        </Link>
                      ) : null;
                    })}
                    {c.sources.map((src, j) => {
                      const x = src.type === "exhibit" ? exhibitByNumber.get(src.ref) : undefined;
                      return x ? (
                        <Link key={j} href={itemHref(symbol, `exhibit:${x.id}`)} scroll={false} className="text-kumo-link hover:underline">
                          Exhibit {x.number}
                        </Link>
                      ) : (
                        <span key={j} className="text-kumo-subtle">
                          {src.label}
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}
        {(r?.exhibits ?? []).map((x) => (
          <Exhibit key={x.id} symbol={symbol} exhibit={x} />
        ))}
        <Provenance
          gold={`gold.narratives ${symbol}${r ? `, gold.narrative_rationales ${symbol}, gold.exhibits ${r.exhibitIds.join(", ") || "none"}` : ""}`}
          silver={`silver.analyses version ${r?.version ?? "of the narrative"} (Claude, figures read from gold)`}
          sources={sources.length ? sources : ["claude"]}
        />
      </>
    ),
  };
}

export async function itemView(symbol: string, item: string): Promise<ItemView | null> {
  if (item === "price") return priceItem(symbol);
  if (item === "fair-value") return fairValueItem(symbol);
  if (item === "narrative") return narrativeItem(symbol);
  const [kind, ...rest] = item.split(":");
  const key = rest.join(":");
  if (kind === "news") return newsItem(symbol, key);
  if (kind === "kpi") return kpiItem(symbol, key);
  if (kind === "driver") return driverItem(symbol, key);
  if (kind === "exhibit") return exhibitItem(symbol, key);
  if (kind === "valuation") return methodItem(symbol, key);
  return null;
}
