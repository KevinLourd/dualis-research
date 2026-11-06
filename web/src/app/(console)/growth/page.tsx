import { Badge, Button } from "@cloudflare/kumo";
import { UsersThreeIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { isoDate } from "@/collectors/markets";
import { CopyButton } from "@/console/content-ui";
import { relativeTime } from "@/console/format";
import { GoalChart } from "@/console/goal-chart";
import { getGrowthRow, type GrowthRow, lastNetworkRun, listAudience, listGrowthTargets } from "@/console/growth-queries";
import { KTable, KTableBody, KTableCell, KTableHead, KTableHeader, KTableRow } from "@/console/kumo";
import { SlideOver } from "@/console/slide-over";
import { Card, ComingNext, Fact, FactList, Missing, PageHeader } from "@/console/ui";
import { saveOutreachMessage, updateOutreachStatus } from "@/growth/actions";
import { GOAL, planned, progress } from "@/growth/goal";

export const metadata = { title: "Growth" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const compact = (n: number | null) => (n === null ? null : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const STATUS: Record<string, { text: string; variant: "neutral" | "primary" | "warning" | "success" | "outline" }> = {
  draft: { text: "To send", variant: "neutral" },
  sent: { text: "Sent", variant: "primary" },
  replied: { text: "Replied", variant: "warning" },
  cited: { text: "Cited", variant: "success" },
  declined: { text: "Declined", variant: "outline" },
  dropped: { text: "Dropped", variant: "outline" },
};
const STATUS_ACTIONS = [
  { status: "sent", label: "Mark sent" },
  { status: "replied", label: "Replied" },
  { status: "cited", label: "Cited us" },
  { status: "declined", label: "Declined" },
  { status: "dropped", label: "Drop" },
  { status: "draft", label: "Back to draft" },
] as const;
const FIT: Record<string, string> = { yes: "Same reader", partly: "Overlaps", no: "Other reader" };

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { text: status, variant: "neutral" as const };
  return <Badge variant={s.variant}>{s.text}</Badge>;
}

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target: key } = await searchParams;
  const [audience, { live, bench }, run] = await Promise.all([listAudience(), listGrowthTargets(), lastNetworkRun()]);
  const selected = key ? await getGrowthRow(key) : null;
  const today = isoDate(new Date());
  const latest = audience.at(-1) ?? null;
  const p = progress(latest, today);
  const planLine = [GOAL.startDate, today < GOAL.endDate ? today : GOAL.endDate, GOAL.endDate]
    .filter((d, i, all) => all.indexOf(d) === i && d >= GOAL.startDate)
    .map((date) => ({ date, value: planned(date) }));
  const sent = live.filter((r) => r.outreach && r.outreach.status !== "draft" && r.outreach.status !== "dropped").length;

  const tiles = [
    { label: "Subscribers now", value: fmt(p.current), note: latest ? `Counted ${dayLabel(latest.date)}` : "Not counted yet" },
    { label: `Goal by ${dayLabel(GOAL.endDate)}`, value: fmt(GOAL.target), note: `${fmt(p.remaining)} to go` },
    { label: "Needed per day", value: fmt(p.perDayNeeded), note: `${p.daysLeft} days left` },
    {
      label: "Against the line",
      value: p.vsPlan === 0 ? "On track" : `${p.vsPlan > 0 ? "+" : ""}${fmt(p.vsPlan)}`,
      note: p.vsPlan < 0 ? `Behind the ${fmt(p.plannedToday)} planned today` : `Planned today: ${fmt(p.plannedToday)}`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Growth"
        description={`Grow Analysis Paralysis to ${fmt(GOAL.target)} subscribers by November 30. Writers who cite, feature or host you bring their readers.`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-kumo-base p-4 ring-1 ring-kumo-hairline">
            <p className="text-sm text-kumo-subtle">{t.label}</p>
            <p className={"mt-1 text-2xl font-semibold tabular " + (t.label === "Against the line" && p.vsPlan < 0 ? "text-dualis-short" : "text-kumo-strong")}>{t.value}</p>
            <p className="mt-0.5 text-sm text-kumo-subtle">{t.note}</p>
          </div>
        ))}
      </div>

      <Card title="Subscribers" action={<span className="text-sm text-kumo-subtle">Counted each morning. Your public count can trail your dashboard by a few.</span>}>
        <div className="p-4">
          {audience.length === 0 ? (
            <p className="text-base text-kumo-subtle">No count yet. The first one lands with the next morning run.</p>
          ) : (
            <GoalChart actual={audience.map((a) => ({ date: a.date, value: a.subscribers }))} plan={planLine} />
          )}
        </div>
      </Card>

      {live.length === 0 && bench.length === 0 ? (
        <ComingNext
          icon={<UsersThreeIcon size={40} className="text-kumo-inactive" />}
          title="No target yet"
          description={
            run?.status === "failed"
              ? `The last Substack crawl (${relativeTime(run.startedAt)}) failed. The Data page shows why.`
              : "The Substack crawl has not run yet. It runs every morning and ranks the writers whose readers match yours."
          }
        />
      ) : (
        <>
          <Card title="Writers to contact" action={<span className="text-sm text-kumo-subtle">{sent} of {live.length} contacted</span>}>
            <TargetTable rows={live} selectedKey={key} withStatus />
          </Card>
          {bench.length > 0 && (
            <Card title="Next in line" action={<span className="text-sm text-kumo-subtle">Ranked by fit, reach and how often our niche recommends them</span>}>
              <TargetTable rows={bench} selectedKey={key} />
            </Card>
          )}
        </>
      )}

      {selected && <TargetPanel row={selected} />}
    </>
  );
}

function TargetTable({ rows, selectedKey, withStatus = false }: { rows: GrowthRow[]; selectedKey?: string; withStatus?: boolean }) {
  return (
    <KTable>
      <KTableHeader>
        <KTableRow>
          <KTableHead>Publication</KTableHead>
          <KTableHead className="text-right">Subscribers</KTableHead>
          <KTableHead className="text-right">Recommended by</KTableHead>
          <KTableHead>Last post</KTableHead>
          <KTableHead>Reader fit</KTableHead>
          {withStatus && <KTableHead>Status</KTableHead>}
        </KTableRow>
      </KTableHeader>
      <KTableBody>
        {rows.map(({ key, target: t, outreach: o }) => (
          <KTableRow key={key} variant={selectedKey === key ? "selected" : "default"}>
            <KTableCell>
              <Link href={`/growth?target=${encodeURIComponent(key)}`} scroll={false} className="flex flex-col hover:text-kumo-link">
                <span className="font-medium text-kumo-default">{t?.name ?? o?.publicationName ?? key}</span>
                <span className="text-sm text-kumo-subtle">{t?.authorName ?? (o ? `@${o.handle}` : "")}</span>
              </Link>
            </KTableCell>
            <KTableCell className="text-right font-mono tabular">{compact(t?.subscribers ?? null) ?? <Missing>–</Missing>}</KTableCell>
            <KTableCell className="text-right font-mono tabular">{t ? t.inbound : <Missing>–</Missing>}</KTableCell>
            <KTableCell>
              {t?.lastPostAt ? (
                <span className="inline-flex items-center gap-2">
                  {relativeTime(t.lastPostAt)}
                  {t.inactive && <Badge variant="warning">Inactive</Badge>}
                </span>
              ) : (
                <Missing>{t ? "Unknown" : "Not crawled yet"}</Missing>
              )}
            </KTableCell>
            <KTableCell>{t?.fit ? FIT[t.fit] ?? t.fit : <Missing>Not judged</Missing>}</KTableCell>
            {withStatus && <KTableCell>{o ? <StatusBadge status={o.status} /> : null}</KTableCell>}
          </KTableRow>
        ))}
      </KTableBody>
    </KTable>
  );
}

function TargetPanel({ row: { target: t, outreach: o } }: { row: GrowthRow }) {
  return (
    <SlideOver
      closeHref="/growth"
      title={t?.name ?? o?.publicationName ?? "Target"}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {o && <StatusBadge status={o.status} />}
          {t?.authorName ?? (o ? `@${o.handle}` : null)}
          {t && (
            <a href={t.url} target="_blank" rel="noreferrer" className="text-kumo-link hover:underline">
              Open
            </a>
          )}
        </span>
      }
    >
      {t?.excludedReason && <p className="rounded-lg bg-kumo-recessed p-3 text-base text-kumo-default">Not a target for now. {t.excludedReason}</p>}

      <section className="rounded-lg ring-1 ring-kumo-hairline">
        <h3 className="border-b border-kumo-hairline px-4 py-3 text-sm font-medium text-kumo-subtle">Why them</h3>
        <FactList>
          {o?.hook && <Fact label="Hook">{o.hook}</Fact>}
          {o?.ask && <Fact label="Ask">{o.ask}</Fact>}
          <Fact label="About">{t?.heroText ?? <Missing>Not crawled yet</Missing>}</Fact>
          <Fact label="Subscribers">
            {t?.subscribers != null ? `${fmt(t.subscribers)}${t.subscribersAt ? ` on ${dayLabel(t.subscribersAt)}` : ""}` : <Missing>Not public</Missing>}
          </Fact>
          <Fact label="Recommended by">{t ? `${t.inbound} publications of our niche` : <Missing>Not crawled yet</Missing>}</Fact>
          <Fact label="Reader fit">
            {t?.fit ? (
              <span>
                {FIT[t.fit] ?? t.fit} ({Math.round((t.fitProbability ?? 0) * 100)}% confident)
                {t.fitSentence && <span className="block text-kumo-subtle">&ldquo;{t.fitSentence}&rdquo;</span>}
              </span>
            ) : (
              <Missing>Not judged yet</Missing>
            )}
          </Fact>
        </FactList>
      </section>

      {t && t.recentPosts.length > 0 && (
        <section className="rounded-lg ring-1 ring-kumo-hairline">
          <h3 className="flex items-center justify-between border-b border-kumo-hairline px-4 py-3 text-sm font-medium text-kumo-subtle">
            Latest posts {t.inactive && <Badge variant="warning">No post for 60 days</Badge>}
          </h3>
          <ul className="divide-y divide-kumo-hairline">
            {t.recentPosts.map((post) => (
              <li key={`${post.date}-${post.title}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-base">
                {post.url ? (
                  <a href={post.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-kumo-link hover:underline">
                    {post.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate">{post.title}</span>
                )}
                <span className="shrink-0 text-sm text-kumo-subtle">
                  {dayLabel(post.date.slice(0, 10))}
                  {post.audience === "only_paid" ? " · paid" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o ? (
        <>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-kumo-subtle">
              Message {o.bodySource === "console" ? "(your version)" : "(drafted by Claude, edit it to make it yours)"}
            </h3>
            <form action={saveOutreachMessage} className="flex flex-col gap-3">
              <input type="hidden" name="handle" value={o.handle} />
              <textarea
                name="body"
                defaultValue={o.body}
                rows={14}
                aria-label="Message"
                className="w-full rounded-lg bg-kumo-base p-3 text-base text-kumo-default ring-1 ring-kumo-line focus:ring-2 focus:ring-kumo-brand focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary">
                  Save message
                </Button>
                <CopyButton text={o.body} />
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-kumo-subtle">Send it yourself:</span>
              {o.contacts.map((c) => (
                <a key={c.href} href={c.href} target="_blank" rel="noreferrer">
                  <Button variant="secondary" size="sm" tabIndex={-1}>
                    {c.label}
                  </Button>
                </a>
              ))}
            </div>
            <p className="text-sm text-kumo-subtle">One follow-up after 4 days, then stop.</p>
          </section>

          <section className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-kumo-hairline">
            <h3 className="text-sm font-medium text-kumo-subtle">Status{o.statusAt ? `, changed ${relativeTime(o.statusAt)}` : ""}</h3>
            <div className="flex flex-wrap gap-2">
              {STATUS_ACTIONS.filter((a) => a.status !== o.status).map((a) => (
                <form key={a.status} action={updateOutreachStatus}>
                  <input type="hidden" name="handle" value={o.handle} />
                  <input type="hidden" name="status" value={a.status} />
                  <Button type="submit" variant={a.status === "sent" ? "primary" : a.status === "draft" ? "ghost" : "secondary"}>
                    {a.label}
                  </Button>
                </form>
              ))}
            </div>
          </section>

          {o.bodySource === "console" && o.claudeBody && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-kumo-subtle">Claude&apos;s first draft</h3>
              <p className="rounded-lg bg-kumo-recessed p-4 text-sm whitespace-pre-wrap text-kumo-subtle">{o.claudeBody}</p>
            </section>
          )}
        </>
      ) : (
        <p className="text-base text-kumo-subtle">No message drafted for this writer yet. Ask Claude to draft one in the private outreach files.</p>
      )}
    </SlideOver>
  );
}
