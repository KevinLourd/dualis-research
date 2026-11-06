import Link from "@/console/link";

/** Filter chip (link), same look as the market chips on Tickers. */
export function Chip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm ring-1 transition-colors " +
        (active ? "bg-kumo-brand text-white ring-kumo-brand" : "bg-kumo-base text-kumo-default ring-kumo-hairline hover:bg-kumo-tint")
      }
    >
      {label}
      {count !== undefined && <span className={"font-mono text-xs " + (active ? "text-white/80" : "text-kumo-subtle")}>{count}</span>}
    </Link>
  );
}
