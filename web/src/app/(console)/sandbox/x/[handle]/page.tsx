import { notFound } from "next/navigation";
import { sandboxAccount } from "@/console/sandbox-queries";
import { SandboxLabel, XProfile } from "@/console/sandbox-ui";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  return { title: `Sandbox @${(await params).handle}` };
}

export default async function SandboxXPage({ params }: { params: Promise<{ handle: string }> }) {
  const view = await sandboxAccount("x", (await params).handle);
  if (!view) notFound();
  return (
    <>
      <SandboxLabel />
      <XProfile account={view.account} posts={view.posts} pairedHref={`/sandbox/substack/${view.account.handle}`} />
    </>
  );
}
