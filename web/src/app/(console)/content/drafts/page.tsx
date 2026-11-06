import { NotePencilIcon } from "@phosphor-icons/react/ssr";
import { FORMAT_LABEL } from "@/collectors/dimensions/content-drafts/format";
import { Chip } from "@/console/chip";
import { getDraft, listDrafts, listIdeas } from "@/console/content-queries";
import { DraftPanel, StatusBadge } from "@/console/draft-panel";
import { relativeTime } from "@/console/format";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { RowLink } from "@/console/row-link";
import { ComingNext } from "@/console/ui";

export const metadata = { title: "Drafts" };

const STATUSES = [
  { value: "all", label: "All" },
  { value: "draft", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" },
  { value: "dismissed", label: "Dismissed" },
] as const;

type Filters = { status?: string; ticker?: string; idea?: string };

/** The URL of this page with some filters changed (an empty value removes the filter). */
function hrefWith(current: Filters, change: Filters & { draft?: string }): string {
  const next = { ...current, ...change };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v && !(k === "status" && v === "all")) q.set(k, v);
  const s = q.toString();
  return s ? `/content/drafts?${s}` : "/content/drafts";
}

/** Content > Drafts: every draft written, all of them, per ticker or per idea. A row opens the draft on the right. */
export default async function DraftsPage({ searchParams }: { searchParams: Promise<Filters & { draft?: string }> }) {
  const { draft: draftId, ...filters } = await searchParams;
  const status = filters.status ?? "all";
  const [all, ideas, selected] = await Promise.all([listDrafts(), listIdeas(), draftId ? getDraft(draftId) : null]);
  const ideaTitle = new Map(ideas.map((i) => [i.id, i.title]));
  const scoped = all.filter((d) => (!filters.ticker || d.symbol === filters.ticker) && (!filters.idea || d.ideaId === filters.idea));
  const rows = scoped.filter((d) => status === "all" || d.status === status);
  const tickers = [...new Set(all.map((d) => d.symbol))].sort();
  const close = hrefWith(filters, {});

  if (all.length === 0) {
    return (
      <ComingNext
        icon={<NotePencilIcon size={40} className="text-kumo-inactive" />}
        title="No draft yet"
        description="Open an idea in Ideas and press Create draft on the channel you want. The draft lands here."
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="Filter by ticker">
          <Chip href={hrefWith(filters, { ticker: "" })} active={!filters.ticker} label="Every ticker" count={all.length} />
          {tickers.map((t) => (
            <Chip key={t} href={hrefWith(filters, { ticker: t })} active={filters.ticker === t} label={t} count={all.filter((d) => d.symbol === t).length} />
          ))}
        </nav>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <Chip
              key={s.value}
              href={hrefWith(filters, { status: s.value })}
              active={status === s.value}
              label={s.label}
              count={s.value === "all" ? scoped.length : scoped.filter((d) => d.status === s.value).length}
            />
          ))}
          {filters.idea && (
            <Chip href={hrefWith(filters, { idea: "" })} active label={`Idea: ${ideaTitle.get(filters.idea) ?? "older idea"} ×`} />
          )}
        </nav>
      </div>

      {rows.length === 0 ? (
        <p className="text-base text-kumo-subtle">No draft matches these filters.</p>
      ) : (
        <div className="rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
          <KTable className="table-fixed">
            <KTableHeader>
              <KTableRow>
                <KTableHead className="w-44 pl-6">Format</KTableHead>
                <KTableHead>Draft</KTableHead>
                <KTableHead className="w-28">Ticker</KTableHead>
                <KTableHead className="w-32">Status</KTableHead>
                <KTableHead className="w-32 pr-6 text-right">Written</KTableHead>
              </KTableRow>
            </KTableHeader>
            <KTableBody>
              {rows.map((d) => {
                const idea = d.ideaId ? (ideaTitle.get(d.ideaId) ?? d.inputs.idea?.title) : null;
                return (
                  <RowLink key={d.id} href={hrefWith(filters, { draft: d.id })} label={`Open the ${FORMAT_LABEL[d.format] ?? d.format} draft`}>
                    <KTableCell className="py-4 pl-6">
                      <span className="flex flex-col">
                        <span className="text-sm font-medium text-kumo-default">{FORMAT_LABEL[d.format] ?? d.format}</span>
                        <span className="text-xs text-kumo-subtle">{d.accountName ?? "No account yet"}</span>
                      </span>
                    </KTableCell>
                    <KTableCell className="py-4">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-base text-kumo-strong">{d.title ?? d.body.split("\n")[0]}</span>
                        {idea && <span className="truncate text-sm text-kumo-subtle">Idea: {idea}</span>}
                      </span>
                    </KTableCell>
                    <KTableCell className="py-4 font-mono text-[13px] text-kumo-default">{d.symbol}</KTableCell>
                    <KTableCell className="py-4">
                      <StatusBadge status={d.status} />
                    </KTableCell>
                    <KTableCell className="py-4 pr-6 text-right text-sm text-kumo-subtle">{relativeTime(d.createdAt)}</KTableCell>
                  </RowLink>
                );
              })}
            </KTableBody>
          </KTable>
        </div>
      )}

      {selected && <DraftPanel draft={selected} closeHref={close} />}
    </>
  );
}
