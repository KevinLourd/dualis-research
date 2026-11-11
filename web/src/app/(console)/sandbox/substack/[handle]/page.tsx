import { notFound } from "next/navigation";
import { sandboxAccount } from "@/console/sandbox-queries";
import { SandboxLabel, SubstackHome } from "@/console/sandbox-ui";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  return { title: `Sandbox ${(await params).handle}.substack.com` };
}

export default async function SandboxSubstackPage({ params }: { params: Promise<{ handle: string }> }) {
  const view = await sandboxAccount("substack", (await params).handle);
  if (!view) notFound();
  return (
    <>
      <SandboxLabel />
      <SubstackHome account={view.account} posts={view.posts} pairedHref={`/sandbox/x/${view.account.handle}`} />
    </>
  );
}
