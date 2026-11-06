import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import type { GoldConsensus, GoldConsensusCoverage } from "@/db/schema/consensus";
import { compactMoney } from "./format";
import { Card, SourceTags, TickerLink } from "./ui";

const METRIC: Record<string, string> = { revenue: "Revenue", ebitda: "EBITDA", "operating-income": "Operating income", "net-income": "Net income", eps: "EPS" };
const period = (type: string, end: string) => {
  const label = new Date(`${end}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return type === "year" ? `FY ending ${label}` : `Quarter ending ${label}`;
};
const fmt = (metric: string, v: number | null) => (v === null ? "–" : metric === "eps" ? v.toFixed(2) : (compactMoney(v, null) ?? "–"));

/** Ticker page: analyst consensus per period and metric, with the actual once reported (read-only, gold.consensus). */
export function ConsensusCard({ rows }: { rows: GoldConsensus[] }) {
  const withConsensus = rows.filter((r) => r.mean !== null);
  return (
    <Card title="Analyst consensus">
      {withConsensus.length === 0 ? (
        <p className="p-4 text-base text-kumo-subtle">No free source publishes analyst estimates for this ticker.</p>
      ) : (
        <KTable>
          <KTableHeader>
            <KTableRow>
              <KTableHead>Period</KTableHead>
              <KTableHead>Metric</KTableHead>
              <KTableHead className="text-right">Low</KTableHead>
              <KTableHead className="text-right">Mean</KTableHead>
              <KTableHead className="text-right">High</KTableHead>
              <KTableHead className="text-right">Analysts</KTableHead>
              <KTableHead className="text-right">Actual</KTableHead>
              <KTableHead className="text-right">Vs mean</KTableHead>
              <KTableHead>Sources</KTableHead>
            </KTableRow>
          </KTableHeader>
          <KTableBody>
            {withConsensus.map((r) => {
              const gap = r.actual !== null && r.mean ? (r.actual - r.mean) / Math.abs(r.mean) : null;
              const sources = [...new Set(Object.values(r.provenance).flatMap((p) => p.sources))];
              return (
                <KTableRow key={`${r.periodType}|${r.periodEnd}|${r.metric}`}>
                  <KTableCell className="whitespace-nowrap">{period(r.periodType, r.periodEnd)}</KTableCell>
                  <KTableCell>{METRIC[r.metric] ?? r.metric}</KTableCell>
                  <KTableCell className="text-right font-mono tabular text-kumo-subtle">{fmt(r.metric, r.low)}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{fmt(r.metric, r.mean)}</KTableCell>
                  <KTableCell className="text-right font-mono tabular text-kumo-subtle">{fmt(r.metric, r.high)}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{r.analysts ?? "–"}</KTableCell>
                  <KTableCell className="text-right font-mono tabular">{fmt(r.metric, r.actual)}</KTableCell>
                  <KTableCell className={`text-right font-mono tabular ${gap === null ? "" : gap >= 0 ? "text-dualis-long" : "text-dualis-short"}`}>
                    {gap === null ? "–" : `${gap >= 0 ? "+" : "-"}${Math.abs(gap * 100).toFixed(0)}%`}
                  </KTableCell>
                  <KTableCell><SourceTags sources={sources} /></KTableCell>
                </KTableRow>
              );
            })}
          </KTableBody>
        </KTable>
      )}
    </Card>
  );
}

/** Data page: per ticker, which free source gave a consensus and which only actuals; none is said plainly. */
export function ConsensusCoverageCard({ rows }: { rows: GoldConsensusCoverage[] }) {
  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const of = (symbol: string) => rows.filter((r) => r.symbol === symbol);
  const covered = symbols.filter((s) => of(s).some((r) => r.status === "estimates")).length;
  return (
    <Card title="Consensus coverage per ticker" action={rows.length > 0 && <span className="text-sm text-kumo-subtle">{covered}/{symbols.length} tickers with an analyst consensus</span>}>
      {rows.length === 0 ? (
        <p className="p-4 text-base text-kumo-subtle">The consensus collector has not run yet.</p>
      ) : (
        <KTable>
          <KTableHeader>
            <KTableRow>
              <KTableHead>Ticker</KTableHead>
              <KTableHead>Market</KTableHead>
              <KTableHead>Consensus from</KTableHead>
              <KTableHead>Actuals from</KTableHead>
              <KTableHead>Failed</KTableHead>
            </KTableRow>
          </KTableHeader>
          <KTableBody>
            {symbols.map((symbol) => {
              const own = of(symbol);
              const estimates = own.filter((r) => r.status === "estimates").map((r) => r.source);
              const actuals = own.filter((r) => r.actualPeriods > 0).map((r) => r.source);
              const failed = own.filter((r) => r.status === "failed");
              const asked = own.some((r) => r.status !== "not_covered");
              return (
                <KTableRow key={symbol}>
                  <KTableCell><TickerLink symbol={symbol} /></KTableCell>
                  <KTableCell className="text-kumo-subtle">{own[0]?.market}</KTableCell>
                  <KTableCell>
                    {estimates.length > 0 ? (
                      <SourceTags sources={estimates} />
                    ) : (
                      <span className="text-kumo-subtle">{asked ? "None: no free source publishes estimates for it" : "No free source for this market"}</span>
                    )}
                  </KTableCell>
                  <KTableCell>{actuals.length > 0 ? <SourceTags sources={actuals} /> : <span className="text-kumo-subtle">–</span>}</KTableCell>
                  <KTableCell className="text-sm text-dualis-short">{failed.map((f) => `${f.source}: ${f.error ?? "failed"}`).join(" · ")}</KTableCell>
                </KTableRow>
              );
            })}
          </KTableBody>
        </KTable>
      )}
    </Card>
  );
}
