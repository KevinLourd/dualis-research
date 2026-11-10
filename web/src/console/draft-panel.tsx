import { Badge, Button } from "@cloudflare/kumo";
import Link from "@/console/link";
import { FORMAT_LABEL, publishLink, X_LIMIT } from "@/collectors/dimensions/content-drafts/format";
import { updateDraftStatus } from "@/content/actions";
import { CopyButton } from "@/console/content-ui";
import { relativeTime, utc } from "@/console/format";
import { SlideOver } from "@/console/slide-over";
import { VisualZoom } from "@/console/visual-zoom";
import { Fact, FactList, Missing } from "@/console/ui";
import type { GoldContentDraft, GoldContentVisual } from "@/db/schema/content";

/** Draft status in words, the same everywhere in Content. */
const STATUS_BADGE: Record<string, { text: string; variant: "neutral" | "primary" | "success" | "outline" }> = {
  draft: { text: "To review", variant: "neutral" },
  approved: { text: "Approved", variant: "primary" },
  posted: { text: "Posted", variant: "success" },
  dismissed: { text: "Dismissed", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { text: status, variant: "neutral" as const };
  return <Badge variant={s.variant}>{s.text}</Badge>;
}

/** Right panel of one draft: the text, publish / copy, status, and what it was built from. */
export function DraftPanel({ draft, closeHref, visuals = [] }: { draft: GoldContentDraft; closeHref: string; visuals?: GoldContentVisual[] }) {
  const text = draft.title ? `${draft.title}\n\n${draft.body}` : draft.body;
  const link = publishLink(draft.format, draft.body);
  const over = draft.format === "x-post" && draft.body.length > X_LIMIT;
  const { news, idea } = draft.inputs;
  return (
    <SlideOver
      closeHref={closeHref}
      title={`${FORMAT_LABEL[draft.format] ?? draft.format} · ${draft.symbol}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={draft.status} /> {draft.accountName ?? "No account yet"} · Version {draft.version} · {utc(draft.createdAt)}
        </span>
      }
    >
      {draft.ideaId && <Visuals visuals={visuals} name={draft.symbol} />}

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
            <Button variant="secondary" tabIndex={-1}>
              Open the Substack preview
            </Button>
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
          {idea ? (
            <Fact label="Idea">
              <Link href={`/content?idea=${idea.id}`} className="text-kumo-link hover:underline">
                {idea.title}
              </Link>
            </Fact>
          ) : (
            <Fact label="News">
              {news ? (
                <a href={news.url} target="_blank" rel="noreferrer" className="text-kumo-link hover:underline">
                  {news.title}
                </a>
              ) : (
                <Missing>None</Missing>
              )}
            </Fact>
          )}
          {idea && <Fact label="Why now">{idea.angle}</Fact>}
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

const VISUAL_WORD: Record<string, string> = { montage: "Post card", video: "Video", chart: "Note chart", "x-chart": "X chart", capture: "News capture" };

/** The Idea's visuals, ready to attach to the post: a click enlarges one, with its Download. A failed one says why. */
function Visuals({ visuals, name }: { visuals: GoldContentVisual[]; name: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-kumo-subtle">Visuals</h3>
      {visuals.length === 0 ? (
        <p className="text-base text-kumo-subtle">Being made with the draft: they show here in a minute or two.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visuals.map((v) => {
            const src = `/api/visuals/${v.id}`;
            return (
              <li key={v.id} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-kumo-default">{VISUAL_WORD[v.kind] ?? v.kind}</span>
                {v.status === "ok" ? (
                  <>
                    <VisualZoom
                      src={src}
                      video={v.mime === "video/mp4"}
                      title={`${VISUAL_WORD[v.kind] ?? v.kind}: ${name}`}
                      alt={`${VISUAL_WORD[v.kind]} for ${name}`}
                      downloadHref={`${src}?download=1&name=${encodeURIComponent(name)}`}
                    />
                    {v.sourceUrl ? (
                      <a href={v.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-xs text-kumo-subtle hover:underline">
                        {v.caption}
                      </a>
                    ) : (
                      <span className="truncate text-xs text-kumo-subtle">{v.caption}</span>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-kumo-subtle">Not made: {v.error}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
