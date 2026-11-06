import { Badge, Button } from "@cloudflare/kumo";
import { NotePencilIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { FORMAT_LABEL, publishLink, X_LIMIT } from "@/collectors/dimensions/content-drafts/format";
import { updateDraftStatus } from "@/content/actions";
import { getDraft, lastContentRun, listDrafts } from "@/console/content-queries";
import { CopyButton } from "@/console/content-ui";
import { relativeTime, utc } from "@/console/format";
import { SlideOver } from "@/console/slide-over";
import { Chip } from "@/console/chip";
import { Card, ComingNext, Fact, FactList, Missing, TickerLink } from "@/console/ui";
import type { GoldContentDraft } from "@/db/schema/content";

export const metadata = { title: "Content" };

/** "Wed 14:30 UTC": the publishing slot of a draft. */
function slotLabel(d: Date) {
  return `${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${d.toISOString().slice(11, 16)} UTC`;
}

const STATUS_TABS = [
  { value: "draft", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

const STATUS_BADGE: Record<string, { text: string; variant: "neutral" | "primary" | "success" | "outline" }> = {
  draft: { text: "To review", variant: "neutral" },
  approved: { text: "Approved", variant: "primary" },
  posted: { text: "Posted", variant: "success" },
  dismissed: { text: "Dismissed", variant: "outline" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { text: status, variant: "neutral" as const };
  return <Badge variant={s.variant}>{s.text}</Badge>;
}

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ status?: string; draft?: string }> }) {
  const { status = "draft", draft: draftId } = await searchParams;
  const [all, run] = await Promise.all([listDrafts(), lastContentRun("content-drafts")]);
  const rows = (status === "all" ? all : all.filter((d) => d.status === status)).sort(
    (a, b) => (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const selected = draftId ? await getDraft(draftId) : null;
  const base = status === "draft" ? "/content" : `/content?status=${status}`;
  const withDraft = (id: string) => `${base}${base.includes("?") ? "&" : "?"}draft=${id}`;

  // One card per (ticker, news): the formats written in the same generation sit together.
  const groups = new Map<string, GoldContentDraft[]>();
  for (const d of rows) {
    const key = `${d.symbol}\u0000${d.inputKey}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  return (
    <>
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {STATUS_TABS.map((t) => (
          <Chip
            key={t.value}
            href={t.value === "draft" ? "/content" : `/content?status=${t.value}`}
            active={status === t.value}
            label={t.label}
            count={t.value === "all" ? all.length : all.filter((d) => d.status === t.value).length}
          />
        ))}
      </nav>

      {all.length === 0 ? (
        <ComingNext
          icon={<NotePencilIcon size={40} className="text-kumo-inactive" />}
          title="No draft yet"
          description={
            run?.status === "failed"
                ? `The last drafting run (${relativeTime(run.startedAt)}) failed. The Data page shows why.`
                : run
                ? `The last drafting run (${relativeTime(run.startedAt)}) found no fresh news worth a post. Two drafts a day are proposed when one is.`
                : "Drafting has not run yet. It runs every morning after news is collected."
          }
        />
      ) : groups.size === 0 ? (
        <Card title={STATUS_TABS.find((t) => t.value === status)?.label ?? "Drafts"}>
          <p className="p-4 text-base text-kumo-subtle">Nothing here.</p>
        </Card>
      ) : (
        [...groups.values()].map((drafts) => {
          const first = drafts[0];
          const news = first.inputs.news;
          return (
            <Card
              key={`${first.symbol}-${first.inputKey}`}
              title={first.inputs.companyName ?? first.symbol}
              action={
                <span className="text-sm text-kumo-subtle">
                  {first.scheduledAt ? `Slot ${slotLabel(first.scheduledAt)}` : `Drafted ${relativeTime(first.createdAt)}`}
                </span>
              }
            >
              <div className="flex flex-col gap-1 border-b border-kumo-hairline px-4 py-3">
                <span className="flex items-center gap-2">
                  <TickerLink symbol={first.symbol} />
                  {first.inputs.driver && <Badge variant="outline">Driver: {first.inputs.driver.name}</Badge>}
                </span>
                {news && (
                  <a href={news.url} target="_blank" rel="noreferrer" className="text-base text-kumo-link hover:underline">
                    {news.title}
                  </a>
                )}
              </div>
              <ul className="divide-y divide-kumo-hairline">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={withDraft(d.id)}
                      scroll={false}
                      className={"grid grid-cols-[220px_1fr_auto] items-center gap-4 px-4 py-3 hover:bg-kumo-tint " + (draftId === d.id ? "bg-kumo-tint" : "")}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium text-kumo-default">{FORMAT_LABEL[d.format] ?? d.format}</span>
                        <span className="text-xs text-kumo-subtle">{d.accountName ?? "No account yet"}</span>
                      </span>
                      <span className="truncate text-base text-kumo-subtle">{d.title ?? d.body.split("\n")[0]}</span>
                      <StatusBadge status={d.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}

      {selected && <DraftPanel draft={selected} closeHref={base} />}
    </>
  );
}

function DraftPanel({ draft, closeHref }: { draft: GoldContentDraft; closeHref: string }) {
  const text = draft.title ? `${draft.title}\n\n${draft.body}` : draft.body;
  const link = publishLink(draft.format, draft.body);
  const over = draft.format === "x-post" && draft.body.length > X_LIMIT;
  const { news, thesis, driver, worth } = draft.inputs;
  return (
    <SlideOver
      closeHref={closeHref}
      title={`${FORMAT_LABEL[draft.format] ?? draft.format} · ${draft.symbol}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={draft.status} /> {draft.accountName ?? "No account yet"} · Version {draft.version}
          {draft.scheduledAt ? ` · Slot ${slotLabel(draft.scheduledAt)}` : ` · ${utc(draft.createdAt)}`}
        </span>
      }
    >
      <section className="flex flex-col gap-2">
        {draft.title && <h3 className="text-lg font-semibold text-kumo-strong">{draft.title}</h3>}
        <p className="rounded-lg bg-kumo-recessed p-4 text-base whitespace-pre-wrap text-kumo-default">{draft.body}</p>
        <p className={"text-sm " + (over ? "text-dualis-short" : "text-kumo-subtle")}>
          {draft.body.length} characters{draft.format === "x-post" && (over ? `, over the ${X_LIMIT} character X limit: shorten before posting` : ` of ${X_LIMIT}`)}
        </p>
      </section>

      <section className="flex flex-wrap gap-2">
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer">
            <Button variant="primary" tabIndex={-1}>
              {link.label}
            </Button>
          </a>
        )}
        <CopyButton text={text} />
        {draft.format === "substack-article" && (
          <Link href={`/content/drafts/${draft.id}`}>
            <Button variant="secondary" tabIndex={-1}>Open the Substack preview</Button>
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-kumo-hairline">
        <h3 className="text-sm font-medium text-kumo-subtle">Status</h3>
        <div className="flex flex-wrap gap-2">
          {draft.status !== "approved" && draft.status !== "posted" && <StatusForm id={draft.id} status="approved" label="Approve" variant="primary" />}
          {draft.status !== "dismissed" && draft.status !== "posted" && <StatusForm id={draft.id} status="dismissed" label="Dismiss" variant="secondary" />}
          {draft.status !== "draft" && <StatusForm id={draft.id} status="draft" label="Back to review" variant="ghost" />}
        </div>
        {draft.status === "posted" ? (
          <p className="text-base text-kumo-default">
            Posted {relativeTime(draft.statusAt)}
            {draft.postedUrl && (
              <>
                {": "}
                <a href={draft.postedUrl} target="_blank" rel="noreferrer" className="text-kumo-link hover:underline">
                  open the post
                </a>
              </>
            )}
          </p>
        ) : (
          <form action={updateDraftStatus} className="flex items-end gap-2">
            <input type="hidden" name="id" value={draft.id} />
            <input type="hidden" name="status" value="posted" />
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-kumo-subtle">
              Link of the published post (optional)
              <input
                name="postedUrl"
                type="url"
                placeholder="https://"
                className="h-9 rounded-lg bg-kumo-base px-3 text-base text-kumo-default ring-1 ring-kumo-line focus:ring-2 focus:ring-kumo-brand focus:outline-none"
              />
            </label>
            <Button type="submit" variant="secondary">
              Mark posted
            </Button>
          </form>
        )}
      </section>

      <section className="rounded-lg ring-1 ring-kumo-hairline">
        <h3 className="border-b border-kumo-hairline px-4 py-3 text-sm font-medium text-kumo-subtle">Built from</h3>
        <FactList>
          <Fact label="News">
            {news ? (
              <a href={news.url} target="_blank" rel="noreferrer" className="text-kumo-link hover:underline">
                {news.title}
              </a>
            ) : (
              <Missing>None</Missing>
            )}
          </Fact>
          <Fact label="Why this news">
            {worth ? (
              <span>
                {draft.inputs.catalyst
                  ? `${draft.inputs.catalyst.direction === "contradicts" ? "Cracks the market's story" : "Supports the thesis"} (${Math.round(worth.probability * 100)}% sure)${draft.inputs.catalyst.reason ? `: ${draft.inputs.catalyst.reason}` : ""}`
                  : `Judged worth a post (${Math.round(worth.probability * 100)}% sure)`}
                {worth.citedSentence && <span className="block text-kumo-subtle">&ldquo;{worth.citedSentence}&rdquo;</span>}
              </span>
            ) : (
              <Missing>Not judged</Missing>
            )}
          </Fact>
          <Fact label="Thesis">
            {thesis ? (
              <span>
                {thesis.summary}
                <span className="block text-sm text-kumo-subtle">{thesis.author === "draft" ? "Draft thesis prefilled by Claude" : thesis.author === "accepted" ? "Claude's draft, accepted by you" : "Your thesis"}</span>
              </span>
            ) : (
              <Missing>None</Missing>
            )}
          </Fact>
          {driver && <Fact label="Driver">{driver.name}</Fact>}
          <Fact label="Charts">
            {draft.charts?.length ? (
              draft.charts.map((c) => c.title).join(", ")
            ) : (
              <Missing>{draft.format === "substack-article" ? "No chart: no price collected for this ticker" : "Charts go in the Substack article"}</Missing>
            )}
          </Fact>
        </FactList>
      </section>
    </SlideOver>
  );
}

function StatusForm({ id, status, label, variant }: { id: string; status: string; label: string; variant: "primary" | "secondary" | "ghost" }) {
  return (
    <form action={updateDraftStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}
