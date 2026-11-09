"use client";

import { Button, CommandPalette } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export type PaletteTicker = { symbol: string; name: string | null; market: string; inPortfolio: boolean; aliases: string[] };
type Group = { id: string; label: string; items: PaletteTicker[] };

/** ⌘K / Ctrl+K: jump to any ticker by symbol, company name or alias. */
export function TickerSearch({ tickers }: { tickers: PaletteTicker[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo<Group[]>(() => {
    const q = search.trim().toLowerCase();
    const hits = q
      ? tickers.filter((t) => [t.symbol, t.name ?? "", ...t.aliases].some((s) => s.toLowerCase().includes(q)))
      : tickers;
    return [
      { id: "portfolio", label: "Portfolio", items: hits.filter((t) => t.inPortfolio) },
      { id: "watchlist", label: "Watchlist", items: hits.filter((t) => !t.inPortfolio) },
    ].filter((g) => g.items.length > 0);
  }, [search, tickers]);

  const go = (t: PaletteTicker) => {
    setOpen(false);
    setSearch("");
    router.push(`/tickers/${encodeURIComponent(t.symbol)}`);
  };

  return (
    <>
      <Button variant="secondary" icon={MagnifyingGlassIcon} onClick={() => setOpen(true)} className="w-full min-w-0 justify-start sm:w-72">
        <span className="flex-1 text-left text-kumo-subtle">Search tickers</span>
        <kbd className="hidden rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-[10px] text-kumo-subtle sm:inline">⌘K</kbd>
      </Button>
      <CommandPalette.Root
        open={open}
        onOpenChange={setOpen}
        items={groups}
        value={search}
        onValueChange={setSearch}
        itemToStringValue={(g: Group) => g.label}
        getSelectableItems={(gs: Group[]) => gs.flatMap((g) => g.items)}
        onSelect={(t: PaletteTicker) => go(t)}
      >
        <CommandPalette.Input placeholder="Symbol, company or alias" />
        <CommandPalette.List>
          <CommandPalette.Results>
            {(group: Group) => (
              <CommandPalette.Group key={group.id} items={group.items}>
                <CommandPalette.GroupLabel>{group.label}</CommandPalette.GroupLabel>
                <CommandPalette.Items>
                  {(t: PaletteTicker) => (
                    <CommandPalette.Item key={t.symbol} value={t} onClick={() => go(t)}>
                      <span className="flex w-full items-center gap-3">
                        <span className="w-24 shrink-0 font-mono text-[13px] font-semibold">{t.symbol}</span>
                        <span className="flex-1 truncate">{t.name ?? "Name not collected yet"}</span>
                        <span className="font-mono text-xs text-kumo-subtle">{t.market}</span>
                      </span>
                    </CommandPalette.Item>
                  )}
                </CommandPalette.Items>
              </CommandPalette.Group>
            )}
          </CommandPalette.Results>
          <CommandPalette.Empty>No ticker matches “{search}”.</CommandPalette.Empty>
        </CommandPalette.List>
        <CommandPalette.Footer>
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-[10px]">↑↓</kbd>
            <span>Navigate</span>
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-[10px]">↵</kbd>
            <span>Open</span>
          </span>
        </CommandPalette.Footer>
      </CommandPalette.Root>
    </>
  );
}
