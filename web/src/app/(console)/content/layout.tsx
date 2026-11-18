import { listDrafts, listIdeas } from "@/console/content-queries";
import { ContentTabs } from "@/console/content-tabs";
import { PageHeader } from "@/console/ui";
import { TableSearch } from "@/console/table-search";

export default async function ContentLayout({ children }: { children: React.ReactNode }) {
  const [ideas, drafts] = await Promise.all([listIdeas(), listDrafts()]);
  return (
    <>
      <PageHeader title="Content" />
      <TableSearch placeholder="Search ideas and drafts" tabs={<ContentTabs ideas={ideas.length} drafts={drafts.length} />}>
        {children}
      </TableSearch>
    </>
  );
}
