"use client";

import { Tabs } from "@cloudflare/kumo";
import { useState } from "react";
import Link from "@/console/link";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { TableSearch } from "./table-search";
import { TagBadge } from "./tag-badge";

/**
 * The Analysis page's News section (Kevin 2026-11-06): every judged news item and filing of the year in a table, one
 * column per Narrative Driver with its tag, tabs from the most important (a strong tag on any driver) to the least
 * (noise for every driver), then Too old: news from before the market adopted its current story, not judged.
 */

export type NewsRow = { id: string; href: string; day: string; headline: string; publisher: string | null; strength: "strong" | "weak" | "noise" | "too-old"; tags: ({ effect: string; strength: string } | null)[] };
type Tab = "strong" | "weak" | "noise" | "too-old";

export function NewsTable({ rows, drivers, gapPct }: { rows: NewsRow[]; drivers: { rank: number; title: string }[]; gapPct: number | null }) {
  const count = (t: Tab) => rows.filter((r) => r.strength === t).length;
  const [tab, setTab] = useState<Tab>(count("strong") ? "strong" : count("weak") ? "weak" : "noise");
  const shown = rows.filter((r) => r.strength === tab);
  return (
    <TableSearch
      placeholder="Search news"
      tabs={
      <Tabs
        variant="underline"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "strong", label: `Strong · ${count("strong")}` },
          { value: "weak", label: `Weak · ${count("weak")}` },
          { value: "noise", label: `Noise · ${count("noise")}` },
          ...(count("too-old") ? [{ value: "too-old", label: `Too old · ${count("too-old")}` }] : []),
        ]}
      />
      }
    >
      {shown.length === 0 ? (
        <p className="text-base text-kumo-subtle">No {tab === "too-old" ? "old" : tab} news.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg ring-1 ring-kumo-hairline">
          <KTable>
            <KTableHeader>
              <KTableRow>
                <KTableHead className="w-28 pl-4">Date</KTableHead>
                <KTableHead>News</KTableHead>
                {drivers.map((d) => (
                  <KTableHead key={d.rank} className="w-44 pr-4" title={d.title}>
                    Driver {d.rank}
                  </KTableHead>
                ))}
              </KTableRow>
            </KTableHeader>
            <KTableBody>
              {shown.map((r) => (
                <KTableRow key={r.id}>
                  <KTableCell className="pl-4 align-top whitespace-nowrap tabular text-kumo-subtle">{r.day}</KTableCell>
                  <KTableCell className="align-top">
                    <Link href={r.href} scroll={false} className="flex flex-col gap-0.5 hover:underline">
                      <span className="font-medium text-kumo-strong">{r.headline}</span>
                      {r.publisher && <span className="text-sm text-kumo-subtle">{r.publisher}</span>}
                    </Link>
                  </KTableCell>
                  {r.tags.map((t, i) => (
                    <KTableCell key={i} className="pr-4 align-top">
                      {t ? <TagBadge effect={t.effect} strength={t.strength} gapPct={gapPct} /> : <span className="text-kumo-subtle">–</span>}
                    </KTableCell>
                  ))}
                </KTableRow>
              ))}
            </KTableBody>
          </KTable>
        </div>
      )}
    </TableSearch>
  );
}
