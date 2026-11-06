import { Badge } from "@cloudflare/kumo";
import Link from "@/console/link";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { STRENGTH_WORD, type SignalCall, type SignalStrength } from "@/content/signal-words";
import type { BoardRow } from "./board-queries";
import { price } from "./format";
import { CompanyLogo } from "./market";
import { RowLink } from "./row-link";

/** Level A pieces (server components): the call, the strength, the quote against the fair value, the Signals table. */

export function CallBadge({ call }: { call: SignalCall | null }) {
  if (!call) return <span className="text-kumo-subtle">None</span>;
  return (
    <Badge variant="secondary" className={`font-semibold tracking-wide ${call === "BUY" ? "bg-dualis-long-soft text-dualis-long" : "bg-dualis-short-soft text-dualis-short"}`}>
      {call}
    </Badge>
  );
}

const STRENGTH_VARIANT: Record<SignalStrength, "success" | "warning" | "neutral"> = { strong: "success", weak: "warning", noise: "neutral" };
export function StrengthBadge({ strength }: { strength: SignalStrength }) {
  return (
    <Badge appearance="dot" variant={STRENGTH_VARIANT[strength]}>
      {STRENGTH_WORD[strength]}
    </Badge>
  );
}

/** The last close, and how far it sits from the fair value. */
export function QuoteGap({ row, align = "right" }: { row: Pick<BoardRow, "close" | "currency" | "gap">; align?: "right" | "left" }) {
  if (row.close === null) return <span className="text-kumo-subtle">–</span>;
  return (
    <span className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="font-mono tabular text-kumo-strong">
        {price(row.close)} <span className="text-kumo-subtle">{row.currency}</span>
      </span>
      {row.gap && (
        <span className={`text-sm tabular ${row.gap.side === "below" ? "text-dualis-long" : "text-dualis-short"}`}>
          {Math.round(row.gap.pct * 100)}% {row.gap.side} fair value
        </span>
      )}
    </span>
  );
}

export function FairValue({ row }: { row: Pick<BoardRow, "fairValue" | "fairValueCurrency"> }) {
  if (row.fairValue === null) return <span className="text-kumo-subtle">–</span>;
  return (
    <span className="font-mono tabular text-kumo-default">
      {price(row.fairValue)} <span className="text-kumo-subtle">{row.fairValueCurrency}</span>
    </span>
  );
}

/** One row per ticker: the whole row opens the panel, the company name opens the full Analysis page. */
export function SignalTable({ rows, panelHref }: { rows: BoardRow[]; panelHref: (symbol: string) => string }) {
  return (
    <div className="rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
      <KTable className="table-fixed">
        <KTableHeader>
          <KTableRow>
            <KTableHead className="w-32 pl-6">Signal</KTableHead>
            <KTableHead>Company</KTableHead>
            <KTableHead className="w-40 text-right">Fair value</KTableHead>
            <KTableHead className="w-56 text-right">Quote</KTableHead>
            <KTableHead className="w-40 pl-10 pr-6">Strength</KTableHead>
          </KTableRow>
        </KTableHeader>
        <KTableBody>
          {rows.map((r) => (
            <RowLink key={r.symbol} href={panelHref(r.symbol)} label={`Open ${r.name ?? r.symbol}`}>
              <KTableCell className="py-4 pl-6">
                <CallBadge call={r.call} />
              </KTableCell>
              <KTableCell className="py-4">
                <Link href={`/tickers/${encodeURIComponent(r.symbol)}`} className="group inline-flex items-center gap-3" title="Open the full analysis">
                  <CompanyLogo src={r.logoUrl} name={r.name ?? r.symbol} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-kumo-strong group-hover:text-kumo-link group-hover:underline">{r.name ?? r.symbol}</span>
                    <span className="font-mono text-[12px] text-kumo-subtle">{r.symbol}</span>
                  </span>
                </Link>
              </KTableCell>
              <KTableCell className="py-4 text-right">
                <FairValue row={r} />
              </KTableCell>
              <KTableCell className="py-4 text-right">
                <QuoteGap row={r} />
              </KTableCell>
              <KTableCell className="py-4 pl-10 pr-6">
                <StrengthBadge strength={r.strength} />
              </KTableCell>
            </RowLink>
          ))}
        </KTableBody>
      </KTable>
    </div>
  );
}

/** Inactive tab: watchlist tickers outside the analysis scope. Name and quote only, for information: nothing is analysed. */
export function InactiveTable({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
      <KTable className="table-fixed">
        <KTableHeader>
          <KTableRow>
            <KTableHead className="pl-6">Company</KTableHead>
            <KTableHead className="w-56 pr-6 text-right">Quote</KTableHead>
          </KTableRow>
        </KTableHeader>
        <KTableBody>
          {rows.map((r) => (
            <KTableRow key={r.symbol}>
              <KTableCell className="py-4 pl-6">
                <span className="inline-flex items-center gap-3">
                  <CompanyLogo src={r.logoUrl} name={r.name ?? r.symbol} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-medium text-kumo-strong">{r.name ?? r.symbol}</span>
                    <span className="font-mono text-[12px] text-kumo-subtle">{r.symbol}</span>
                  </span>
                </span>
              </KTableCell>
              <KTableCell className="py-4 pr-6 text-right tabular-nums text-kumo-default">
                {price(r.close, r.currency) ?? "n/a"}
              </KTableCell>
            </KTableRow>
          ))}
        </KTableBody>
      </KTable>
    </div>
  );
}
