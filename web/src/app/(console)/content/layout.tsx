import { PageHeader } from "@/console/ui";

export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Content" description="Drafts for X, LinkedIn and Substack, built from the news on your watchlist." />
      {children}
    </>
  );
}
