"use client";

import { Table } from "@cloudflare/kumo";
import { useRouter } from "next/navigation";
import { usePrefetchOnIntent } from "./link";

/**
 * A table row that opens `href` (the right panel, `?ticker=`) on click or Enter. A link or button inside the row
 * keeps its own target (the company name opens the full Analysis page). The panel loads as soon as the pointer or focus
 * reaches the row (`usePrefetchOnIntent`), so the click is instant.
 */
export function RowLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  const router = useRouter();
  const load = usePrefetchOnIntent(href);
  const open = () => router.push(href, { scroll: false });
  return (
    <Table.Row
      tabIndex={0}
      aria-label={label}
      onMouseEnter={load}
      onFocus={load}
      onTouchStart={load}
      className="cursor-pointer transition-colors hover:bg-kumo-tint focus-visible:bg-kumo-tint focus-visible:outline-none"
      onClick={(e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        open();
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.target === e.currentTarget) open();
      }}
    >
      {children}
    </Table.Row>
  );
}
