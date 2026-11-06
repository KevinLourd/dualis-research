import { listDrafts, listIdeas } from "@/console/content-queries";
import { ContentTabs } from "@/console/content-tabs";
import { PageHeader } from "@/console/ui";

export default async function ContentLayout({ children }: { children: React.ReactNode }) {
  const [ideas, drafts] = await Promise.all([listIdeas(), listDrafts()]);
  return (
    <>
      <PageHeader title="Content" description="What to publish next, ranked for each channel. Open an idea to draft it." />
      <ContentTabs ideas={ideas.length} drafts={drafts.length} />
      {children}
    </>
  );
}
