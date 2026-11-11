import { UsersThreeIcon } from "@phosphor-icons/react/ssr";
import Link from "@/console/link";
import { listSandboxAccounts } from "@/console/sandbox-queries";
import { Avatar, SandboxLabel, TONE_LABEL } from "@/console/sandbox-ui";
import { ComingNext, PageHeader } from "@/console/ui";
import type { GoldSandboxAccount } from "@/db/schema/sandbox";

export const metadata = { title: "Sandbox" };

function AccountButton({ a }: { a: GoldSandboxAccount }) {
  const tone = TONE_LABEL[a.tone];
  return (
    <Link
      href={`/sandbox/${a.platform}/${a.handle}`}
      className="flex items-center gap-4 rounded-lg border border-kumo-line bg-kumo-base p-4 transition-colors hover:bg-kumo-tint"
    >
      <Avatar account={a} size={48} />
      <span className="flex min-w-0 flex-col">
        <span className="text-base font-semibold text-kumo-strong">{a.displayName}</span>
        <span className="text-sm text-kumo-subtle">{a.platform === "x" ? `@${a.handle}` : a.url}</span>
        <span className="mt-1 text-sm text-kumo-default">
          <b>{tone.name}</b>: {tone.line}
        </span>
      </span>
    </Link>
  );
}

export default async function SandboxPage() {
  const accounts = await listSandboxAccounts();
  const groups = [
    { title: "X accounts", items: accounts.filter((a) => a.platform === "x") },
    { title: "Substack publications", items: accounts.filter((a) => a.platform === "substack") },
  ];
  return (
    <>
      <SandboxLabel />
      <PageHeader title="Sandbox" description="Fake accounts, one per tone, to compare how our posts read before we pick a tone. Nothing here is published." />
      {accounts.length === 0 ? (
        <ComingNext icon={<UsersThreeIcon size={32} />} title="No accounts yet" description="The accounts land with the next daily collect." />
      ) : (
        groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-kumo-strong">{g.title}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {g.items.map((a) => (
                <AccountButton key={a.id} a={a} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
