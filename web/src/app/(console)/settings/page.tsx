import { getOnedriveStatus } from "@/console/onedrive-queries";
import { OnedriveCard } from "@/console/onedrive-ui";
import { Card, PageHeader } from "@/console/ui";
import { getWhatsappLink, latestWhatsappMessages } from "@/console/whatsapp-queries";
import { WhatsappCard } from "@/console/whatsapp-ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [link, messages, onedrive] = await Promise.all([getWhatsappLink(), latestWhatsappMessages(), getOnedriveStatus()]);
  return (
    <>
      <PageHeader title="Settings" />
      <WhatsappCard link={link} messages={messages} />
      <OnedriveCard status={onedrive} />
      <Card title="Watchlist">
        <p className="max-w-prose p-4 text-base text-kumo-default">
          The watchlist comes from the private file <code className="font-mono text-sm">data/watchlist.json</code>:
          symbols, portfolio, names, aliases and thesis notes. Once it is updated, the next collection picks it up.
        </p>
      </Card>
      <Card title="Account">
        <p className="p-4 text-base text-kumo-default">Use the avatar at the top right to manage your sign-in and security.</p>
      </Card>
    </>
  );
}
