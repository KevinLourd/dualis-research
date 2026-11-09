"use client";

import { InputGroup } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { queryWords, rowMatches } from "./search-match";

/**
 * A search box over every table inside it (Kevin 2026-11-06: « in each tab add a search bar »). Filtering runs in the
 * browser on the rows already on screen (no server render per keystroke: Workers CPU rule), so any server-rendered
 * table works without change. The query sits in `?q=` (history only, no navigation) so a search is a link, and it stays
 * when a tab changes the table (new rows are filtered as they arrive). With `tabs`, the box sits IN the tab row, on its
 * right (Kevin 2026-11-06: « la search bar DANS chaque tab »), never above the tabs.
 */
export function TableSearch({
  placeholder = "Search",
  tabs,
  children,
}: {
  placeholder?: string;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState({ shown: 0, total: 0 });
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
  }, []);

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const words = queryWords(query);
    const apply = () => {
      let shown = 0;
      let total = 0;
      root.querySelectorAll("tbody tr").forEach((tr) => {
        const row = tr as HTMLTableRowElement;
        const keep = rowMatches(row.textContent ?? "", words);
        if (row.hidden === keep) row.hidden = !keep;
        total += 1;
        if (keep) shown += 1;
      });
      setCounts((c) =>
        c.shown === shown && c.total === total ? c : { shown, total },
      );
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [query]);

  const change = (value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  };

  const active = queryWords(query).length > 0;
  const box = (
    <div className="flex shrink-0 items-center gap-3">
      {active && (
        <span className="text-sm tabular-nums text-kumo-subtle">
          {counts.shown} of {counts.total}
        </span>
      )}
      <InputGroup size="sm" className={tabs ? "w-full sm:w-64" : "w-full max-w-sm"}>
          <InputGroup.Addon>
            <MagnifyingGlassIcon size={16} />
          </InputGroup.Addon>
          <InputGroup.Input
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              change(e.target.value)
            }
          />
      </InputGroup>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {tabs ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="max-w-full min-w-0 flex-1 overflow-x-auto">{tabs}</div>
          {box}
        </div>
      ) : (
        box
      )}
      <div ref={scope} className="contents">
        {children}
      </div>
      {active && counts.shown === 0 && counts.total > 0 && (
        <p className="text-base text-kumo-subtle">
          Nothing matches “{query.trim()}”.
        </p>
      )}
    </div>
  );
}
