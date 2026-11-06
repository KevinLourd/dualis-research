import { Badge } from "@cloudflare/kumo";
import { CaretRightIcon } from "@phosphor-icons/react/ssr";
import type { Valuation } from "./analysis-queries";
import { FootballField, type FieldRow } from "./football-field";
import { price, relativeTime } from "./format";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "./kumo";
import { RowLink } from "./row-link";

/**
 * The fair value pyramid on screen (Kevin 2026-11-06): the football field, then one row per Valuation Method (low / base /
 * high, weight, a caret: the row opens the method's own panel with its assumptions, calculation, charts and report).
 */

export const methodHref = (symbol: string, method: string) => `/tickers/${encodeURIComponent(symbol)}?item=${encodeURIComponent(`valuation:${method}`)}`;
const val = (v: number | null) => (v === null ? "–" : price(v));

export function fieldRows(v: Valuation): FieldRow[] {
  const rows: FieldRow[] = v.methods
    .filter((m) => m.applicable && m.low !== null && m.base !== null && m.high !== null)
    .map((m) => ({ label: m.name, low: m.low!, base: m.base!, high: m.high!, weight: m.weight?.weight ?? null }));
  if (v.report) rows.push({ label: "Fair value (weighted)", low: v.report.low, base: v.report.base, high: v.report.high, weight: null, total: true });
  return rows;
}

export function ValuationField({ v }: { v: Valuation }) {
  const rows = fieldRows(v);
  if (rows.length === 0) return null;
  return <FootballField rows={rows} fairValue={v.fairValue?.value ?? v.report?.base ?? null} currency={v.report?.currency ?? v.fairValue?.currency ?? null} />;
}

/** Every method of the catalogue the ticker ran: a method that does not fit says why, in grey. */
export function MethodsTable({ symbol, v }: { symbol: string; v: Valuation }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
      <KTable>
        <KTableHeader>
          <KTableRow>
            <KTableHead className="pl-4">Method</KTableHead>
            <KTableHead className="text-right">Low</KTableHead>
            <KTableHead className="text-right">Base</KTableHead>
            <KTableHead className="text-right">High</KTableHead>
            <KTableHead className="text-right">Weight</KTableHead>
            <KTableHead className="w-10 pr-4" />
          </KTableRow>
        </KTableHeader>
        <KTableBody>
          {v.methods.map((m) => (
            <RowLink key={m.method} href={methodHref(symbol, m.method)} label={`Open ${m.name}`}>
              <KTableCell className="py-3 pl-4 align-top">
                {/* The name and how fresh its data is; the description lives in the method's panel (Kevin 2026-11-06). */}
                <span className="flex flex-col gap-0.5">
                  <span className={`font-medium ${m.applicable ? "text-kumo-strong" : "text-kumo-subtle"}`}>{m.name}</span>
                  {m.applicable && m.dataAsOf && (
                    <time dateTime={m.dataAsOf.toISOString()} title={`Latest figure: ${m.dataAsOf.toISOString().slice(0, 10)}`} className="text-sm text-kumo-subtle">
                      Data from {relativeTime(m.dataAsOf)}
                    </time>
                  )}
                </span>
              </KTableCell>
              <KTableCell className="py-3 text-right align-top font-mono tabular">{val(m.low)}</KTableCell>
              <KTableCell className="py-3 text-right align-top font-mono tabular text-kumo-strong">{val(m.base)}</KTableCell>
              <KTableCell className="py-3 text-right align-top font-mono tabular">{val(m.high)}</KTableCell>
              <KTableCell className="py-3 text-right align-top font-mono tabular">{m.weight ? `${Math.round(m.weight.weight * 100)}%` : m.applicable ? "0%" : <Badge variant="neutral">n/a</Badge>}</KTableCell>
              <KTableCell className="py-3 pr-4 text-right align-top">
                <CaretRightIcon size={16} weight="bold" aria-hidden className="text-kumo-subtle" />
              </KTableCell>
            </RowLink>
          ))}
        </KTableBody>
      </KTable>
    </div>
  );
}

/** Low / Fair value / High in three cards. */
export function RangeCards({ low, base, high, currency, baseLabel = "Fair value" }: { low: number | null; base: number; high: number | null; currency: string | null; baseLabel?: string }) {
  const cell = "flex flex-col gap-1 rounded-lg px-4 py-3 ring-1 ring-kumo-hairline";
  const n = (x: number | null) => (x === null ? "–" : `${price(x)}${currency ? ` ${currency}` : ""}`);
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className={cell}>
        <span className="text-sm text-kumo-subtle">Low</span>
        <span className="font-mono tabular text-kumo-default">{n(low)}</span>
      </div>
      <div className={cell}>
        <span className="text-sm text-kumo-subtle">{baseLabel}</span>
        <span className="font-mono tabular font-semibold text-kumo-strong">{n(base)}</span>
      </div>
      <div className={cell}>
        <span className="text-sm text-kumo-subtle">High</span>
        <span className="font-mono tabular text-kumo-default">{n(high)}</span>
      </div>
    </div>
  );
}
