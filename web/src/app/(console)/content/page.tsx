import { Badge } from "@cloudflare/kumo";
import { LightbulbIcon } from "@phosphor-icons/react/ssr";
import { DRAFT_FORMATS, FORMAT_LABEL } from "@/collectors/dimensions/content-drafts/format";
import { requestDraftAction } from "@/content/actions";
import { canDispatch } from "@/content/dispatch";
import { lastContentRun, listIdeas } from "@/console/content-queries";
import { PendingButton } from "@/console/content-ui";
import { relativeTime } from "@/console/format";
import { itemHref } from "@/console/analysis";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import Link from "@/console/link";
import { RowLink } from "@/console/row-link";
import { SlideOver } from "@/console/slide-over";
import { ComingNext } from "@/console/ui";
import type { GoldContentIdea, IdeaRequest, IdeaSourceRef } from "@/db/schema/content";

export const metadata = { title: "Content" };

const KIND_WORD: Record<IdeaSourceRef["kind"], string> = {
  signal: "Signal",
  change: "Signal change",
  evidence: "Evidence",
  driver: "Narrative driver",
  "fair-value": "Fair value",
  report: "Research report",
};

/** Where a source opens: the item panel of the Analysis page when it has one, else the page. */
function sourceHref(s: IdeaSourceRef): string | null {
  if (!s.symbol) return null;
  const id = s.ref.slice(s.ref.indexOf(":") + 1);
  if (s.kind === "evidence") return itemHref(s.symbol, `news:${id}`);
  if (s.kind === "driver") return itemHref(s.symbol, `driver:${id}`);
  if (s.kind === "fair-value") return itemHref(s.symbol, "fair-value");
  return `/tickers/${encodeURIComponent(s.symbol)}`;
}

function dayLabel(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === new Date(Date.now() - 86400_000).toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Score as a number with a colour: 70+ worth posting, 40-69 maybe, below quiet. */
function Score({ value }: { value: number }) {
  const variant = value >= 70 ? "success" : value >= 40 ? "warning" : "neutral";
  return (
    <Badge variant={variant === "neutral" ? "outline" : "secondary"} className={`font-mono tabular-nums ${variant === "success" ? "bg-dualis-long-soft text-dualis-long" : ""}`}>
      {value}
    </Badge>
  );
}

/** Content > Ideas: what to publish next, best first. A row opens the Idea's panel, where each channel x format can be drafted. */
export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ idea?: string }> }) {
  const { idea: ideaId } = await searchParams;
  const [ideas, run] = await Promise.all([listIdeas(), lastContentRun("content-ideas")]);
  const selected = ideaId ? (ideas.find((i) => i.id === ideaId) ?? null) : null;

  if (ideas.length === 0) {
    return (
      <ComingNext
        icon={<LightbulbIcon size={40} className="text-kumo-inactive" />}
        title="No idea yet"
        description={
          run?.status === "failed"
            ? `The last idea run (${relativeTime(run.startedAt)}) failed. The Data page shows why.`
            : "Ideas are proposed every morning from the signals, evidence and fair values, and ranked for each channel."
        }
      />
    );
  }

  return (
    <>
      <div className="rounded-lg bg-kumo-base ring-1 ring-kumo-hairline">
        <KTable className="table-fixed">
          <KTableHeader>
            <KTableRow>
              <KTableHead className="pl-6">Idea</KTableHead>
              <KTableHead className="w-36">Ticker</KTableHead>
              <KTableHead className="w-52">Best for</KTableHead>
              <KTableHead className="w-24 text-right">Drafts</KTableHead>
              <KTableHead className="w-32 pr-6 text-right">Proposed</KTableHead>
            </KTableRow>
          </KTableHeader>
          <KTableBody>
            {ideas.map((i) => (
              <RowLink key={i.id} href={`/content?idea=${i.id}`} label={`Open the idea: ${i.title}`}>
                <KTableCell className="py-4 pl-6">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-base font-medium text-kumo-strong">{i.title}</span>
                    <span className="line-clamp-2 text-sm text-kumo-subtle">{i.angle}</span>
                  </span>
                </KTableCell>
                <KTableCell className="py-4">
                  {i.symbol ? (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-kumo-default">{i.companyName ?? i.symbol}</span>
                      <span className="font-mono text-[12px] text-kumo-subtle">{i.symbol}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-kumo-subtle">Several</span>
                  )}
                </KTableCell>
                <KTableCell className="py-4">
                  {i.bestFormat && i.bestScore !== null ? (
                    <span className="inline-flex items-center gap-2 text-sm text-kumo-default">
                      <Score value={i.bestScore} /> {FORMAT_LABEL[i.bestFormat] ?? i.bestFormat}
                    </span>
                  ) : (
                    <span className="text-sm text-kumo-subtle">Not scored yet</span>
                  )}
                </KTableCell>
                <KTableCell className="py-4 text-right font-mono tabular-nums text-kumo-default">{i.draftCount || <span className="text-kumo-subtle">0</span>}</KTableCell>
                <KTableCell className="py-4 pr-6 text-right text-sm text-kumo-subtle">{dayLabel(i.day)}</KTableCell>
              </RowLink>
            ))}
          </KTableBody>
        </KTable>
      </div>
      {selected && <IdeaPanel idea={selected} />}
    </>
  );
}

function IdeaPanel({ idea }: { idea: GoldContentIdea }) {
  const scoreOf = new Map(idea.scores.map((s) => [s.format, s]));
  const formats = [...DRAFT_FORMATS].sort((a, b) => (scoreOf.get(b)?.score ?? -1) - (scoreOf.get(a)?.score ?? -1));
  const latest = (format: string): IdeaRequest | undefined => idea.requests.find((r) => r.format === format);
  return (
    <SlideOver
      closeHref="/content"
      size="lg"
      title="Idea"
      subtitle={`${idea.companyName ?? idea.symbol ?? "Several tickers"} · proposed ${dayLabel(idea.day).toLowerCase()}`}
    >
      <section className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold text-kumo-strong">{idea.title}</h3>
        <p className="text-base text-kumo-default">{idea.angle}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-kumo-subtle">Draft it</h3>
        <ul className="divide-y divide-kumo-hairline rounded-lg ring-1 ring-kumo-hairline">
          {formats.map((format, n) => {
            const s = scoreOf.get(format);
            const r = latest(format);
            return (
              <li key={format} className="grid grid-cols-[48px_1fr_auto] items-start gap-4 px-4 py-3.5">
                <span className="pt-0.5">{s ? <Score value={s.score} /> : <span className="text-sm text-kumo-subtle">–</span>}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-base font-medium text-kumo-strong">{FORMAT_LABEL[format]}</span>
                  {s?.why && <span className="text-sm text-kumo-subtle">{s.why}</span>}
                  {r?.status === "failed" && <span className="text-sm text-dualis-short">The last try failed: {r.error}</span>}
                </span>
                <RequestAction ideaId={idea.id} format={format} request={r} primary={n === 0} />
              </li>
            );
          })}
        </ul>
        {idea.draftCount > 0 && (
          <Link href={`/content/drafts?idea=${idea.id}`} className="self-start text-sm font-medium text-kumo-link hover:underline">
            All drafts of this idea ›
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-kumo-subtle">Built from</h3>
        <ul className="flex flex-col gap-1">
          {idea.sourceRefs.map((s) => {
            const href = sourceHref(s);
            const body = (
              <>
                <span className="text-xs font-medium tracking-wide text-kumo-subtle uppercase">{KIND_WORD[s.kind] ?? s.kind}</span>
                <span className="text-base text-kumo-default">{s.label}</span>
              </>
            );
            return (
              <li key={s.ref}>
                {href ? (
                  <Link href={href} className="-mx-3 flex flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors hover:bg-kumo-tint">
                    {body}
                  </Link>
                ) : (
                  <span className="flex flex-col gap-0.5 py-2">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </SlideOver>
  );
}

/** Per channel x format: Create draft, Drafting… (with when it starts), or Open draft + Draft again. */
function RequestAction({ ideaId, format, request, primary }: { ideaId: string; format: string; request: IdeaRequest | undefined; primary: boolean }) {
  const form = (label: string, variant: "primary" | "secondary") => (
    <form action={requestDraftAction}>
      <input type="hidden" name="ideaId" value={ideaId} />
      <input type="hidden" name="format" value={format} />
      <PendingButton label={label} pendingLabel="Asking…" variant={variant} />
    </form>
  );
  if (request?.status === "pending") {
    return (
      <span className="flex flex-col items-end gap-0.5 text-right">
        <Badge variant="neutral">Drafting…</Badge>
        <span className="text-xs text-kumo-subtle">
          {canDispatch() ? `asked ${relativeTime(new Date(request.requestedAt))}, about 3 min` : "starts with the next morning run"}
        </span>
      </span>
    );
  }
  if (request?.status === "done" && request.draftId) {
    return (
      <span className="flex items-center gap-2">
        <Link href={`/content/drafts?draft=${request.draftId}`} className="text-sm font-medium text-kumo-link hover:underline">
          Open draft ›
        </Link>
        {form("Draft again", "secondary")}
      </span>
    );
  }
  return form(request?.status === "failed" ? "Try again" : "Create draft", primary ? "primary" : "secondary");
}
