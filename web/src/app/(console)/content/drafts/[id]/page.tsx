import { KBreadcrumbs, KBreadcrumbsCurrent, KBreadcrumbsLink, KBreadcrumbsSeparator } from "@/console/kumo";
import { Button } from "@cloudflare/kumo";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/console/article";
import { getDraft } from "@/console/content-queries";
import { CopyButton } from "@/console/content-ui";
import { FORMAT_LABEL, publishLink } from "@/collectors/dimensions/content-drafts/format";

export const metadata = { title: "Draft preview" };

/** A draft as its readers will see it: for a Substack article, title, subtitle, text and every exhibit in place. */
export default async function DraftPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const draft = await getDraft((await params).id);
  if (!draft) notFound();
  const link = publishLink(draft.format, draft.body);
  const day = (draft.scheduledAt ?? draft.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <KBreadcrumbs>
        <KBreadcrumbsLink href="/content/drafts">Drafts</KBreadcrumbsLink>
        <KBreadcrumbsSeparator />
        <KBreadcrumbsCurrent>
          {FORMAT_LABEL[draft.format] ?? draft.format} · {draft.symbol}
        </KBreadcrumbsCurrent>
      </KBreadcrumbs>

      <div className="flex flex-wrap gap-2">
        <CopyButton text={draft.title ? `${draft.title}\n\n${draft.body}` : draft.body} />
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer">
            <Button variant="primary" tabIndex={-1}>{link.label}</Button>
          </a>
        )}
      </div>

      <article className="mx-auto w-full max-w-[728px] rounded-lg bg-kumo-base px-10 py-12 ring-1 ring-kumo-hairline">
        {draft.title && (
          <h1 className="text-[34px] leading-tight font-bold text-kumo-strong" style={{ fontFamily: "Newsreader, Georgia, 'Times New Roman', serif" }}>
            {draft.title}
          </h1>
        )}
        <p className="mt-3 mb-8 text-sm text-kumo-subtle">
          {draft.accountName ?? "No account yet"} · {day}
        </p>
        {draft.format === "substack-article" ? (
          <ArticleBody markdown={draft.body} charts={draft.charts ?? []} />
        ) : (
          <p className="text-[17px] leading-[1.7] whitespace-pre-wrap text-kumo-default">{draft.body}</p>
        )}
      </article>
    </>
  );
}
