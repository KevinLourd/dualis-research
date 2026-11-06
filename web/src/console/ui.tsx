import { KLayerCard, KLayerCardPrimary, KLayerCardSecondary } from "@/console/kumo";
import { Badge, Empty } from "@cloudflare/kumo";
import Link from "@/console/link";

/** Shared console primitives (server components) on top of Kumo. */

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-kumo-strong">{title}</h1>
        {description && <p className="max-w-prose text-base text-kumo-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Card with a title row, Cloudflare dashboard style. */
export function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <KLayerCard className={className}>
      <KLayerCardSecondary className="flex items-center justify-between">
        <span>{title}</span>
        {action}
      </KLayerCardSecondary>
      <KLayerCardPrimary className="p-0">{children}</KLayerCardPrimary>
    </KLayerCard>
  );
}

/** Honest empty state for a section a later release fills. Never fake data. */
export function ComingNext({ icon, title, description, size = "lg", bare = false }: { icon: React.ReactNode; title: string; description: string; size?: "sm" | "lg"; bare?: boolean }) {
  if (bare) return <Empty size={size} icon={icon} title={title} description={description} />;
  return (
    <KLayerCard>
      <KLayerCardPrimary>
        <Empty size={size} icon={icon} title={title} description={description} />
      </KLayerCardPrimary>
    </KLayerCard>
  );
}

const RUN_VARIANT = { succeeded: "success", ok: "success", partial: "warning", failed: "error", running: "neutral", skipped: "neutral" } as const;
const RUN_TEXT: Record<string, string> = { succeeded: "Succeeded", ok: "OK", partial: "Partial", failed: "Failed", running: "Running", skipped: "Skipped" };

export function RunStatus({ status }: { status: string }) {
  return (
    <Badge appearance="dot" variant={RUN_VARIANT[status as keyof typeof RUN_VARIANT] ?? "neutral"}>
      {RUN_TEXT[status] ?? status}
    </Badge>
  );
}

/** LONG / SHORT keep the Dualis data colours; WATCH is neutral. */
export function PositionTags({ inPortfolio, position }: { inPortfolio: boolean; position: string }) {
  const tone =
    position === "long"
      ? "bg-dualis-long-soft text-dualis-long"
      : position === "short"
        ? "bg-dualis-short-soft text-dualis-short"
        : "";
  return (
    <span className="inline-flex items-center gap-1.5">
      {inPortfolio && <Badge variant="primary">Portfolio</Badge>}
      <Badge variant={position === "watch" ? "outline" : "secondary"} className={tone}>
        {position[0].toUpperCase() + position.slice(1)}
      </Badge>
    </span>
  );
}

export function SourceTags({ sources }: { sources: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s) => (
        <Badge key={s} variant="outline" className="font-mono text-[11px]">
          {s}
        </Badge>
      ))}
    </span>
  );
}

export function TickerLink({ symbol }: { symbol: string }) {
  return (
    <Link href={`/tickers/${encodeURIComponent(symbol)}`} className="font-mono text-[13px] font-semibold text-kumo-default hover:text-kumo-link">
      {symbol}
    </Link>
  );
}

/** Label / value rows, used in profiles and panels. */
export function FactList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-kumo-hairline">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2.5 text-base">
      <dt className="text-kumo-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 text-kumo-default">{children}</dd>
    </div>
  );
}

export function Missing({ children = "No source has it yet" }: { children?: React.ReactNode }) {
  return <span className="text-kumo-subtle">{children}</span>;
}
