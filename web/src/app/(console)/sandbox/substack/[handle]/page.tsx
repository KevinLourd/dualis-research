import { notFound } from "next/navigation";
import { sandboxAccount, sandboxView } from "@/console/sandbox-queries";
import { SandboxFilters, SubstackHome } from "@/console/sandbox-ui";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  return { title: `Sandbox ${(await params).handle}.substack.com` };
}

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ params, searchParams }: Props) {
  const [{ handle }, q] = await Promise.all([params, searchParams]);
  const data = await sandboxAccount("substack", handle);
  if (!data) notFound();
  const view = sandboxView(q);
  const posts = data.posts.filter((p) => (!view.format || p.format === view.format));
  const base = `/sandbox/substack/${data.account.handle}`;
  return (
    <>
      <SandboxFilters base={base} view={view} formats={["substack-note", "substack-article"]} />
      <SubstackHome account={data.account} posts={posts} total={data.posts.length} pairedHref={`/sandbox/x/${data.account.handle}`} base={base} view={view} />
    </>
  );
}
