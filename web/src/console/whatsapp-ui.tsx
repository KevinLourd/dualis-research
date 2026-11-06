import { Badge } from "@cloudflare/kumo";
import type { GoldWhatsappMessage, WhatsappLink } from "@/db/schema/whatsapp";
import { relativeTime, utc } from "./format";
import { Card } from "./ui";
import { AutoRefresh } from "./whatsapp-refresh";

/** Before the first link the number is unknown here (personal: never in the public repo). */
const DEVICE_NUMBER = "the Dualis WhatsApp number";
/** The service checks in on its idle tick (30 min); twice that without news means it is down. */
const STALE_AFTER_MS = 70 * 60_000;

function phone(digits: string | null) {
  return digits ? `+${digits}` : DEVICE_NUMBER;
}

export function WhatsappCard({ link, messages, now = new Date() }: { link: WhatsappLink | null; messages: GoldWhatsappMessage[]; now?: Date }) {
  const stale = link ? now.getTime() - link.lastSeenAt.getTime() > STALE_AFTER_MS : false;
  const badge =
    !link || link.status === "starting" ? (
      <Badge appearance="dot" variant="neutral">Starting</Badge>
    ) : link.status === "linked" && !stale ? (
      <Badge appearance="dot" variant="success">Linked</Badge>
    ) : link.status === "linked" ? (
      <Badge appearance="dot" variant="warning">Service silent</Badge>
    ) : (
      <Badge appearance="dot" variant="warning">Not linked</Badge>
    );
  return (
    <Card title="WhatsApp" action={badge}>
      <div className="flex flex-col gap-4 p-4 text-base text-kumo-default">
        {!link && <p>The WhatsApp service has not reported yet. This card updates once it starts.</p>}
        {link?.status === "starting" && <p>The service is connecting to WhatsApp.</p>}
        {link?.status === "linked" && (
          <p>
            Messages go out from {phone(link.phone)}, signed Dualis Research.{" "}
            <span className={stale ? "text-kumo-danger" : "text-kumo-subtle"} title={utc(link.lastSeenAt)}>
              {stale ? `The service has been silent since ${relativeTime(link.lastSeenAt, now)}.` : `Last check ${relativeTime(link.lastSeenAt, now)}.`}
            </span>
          </p>
        )}
        {(link?.status === "waiting-for-scan" || link?.status === "logged-out") && (
          <div className="flex flex-wrap items-start gap-6">
            {link.qrSvg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qrSvg)}`}
                alt="WhatsApp pairing code"
                width={224}
                height={224}
                className="rounded-md border border-kumo-hairline bg-white p-2"
              />
            ) : (
              <div className="flex size-56 items-center justify-center rounded-md border border-kumo-hairline text-sm text-kumo-subtle">Waiting for a new code</div>
            )}
            <div className="flex max-w-prose flex-col gap-2">
              {link.error && <p className="text-kumo-danger">{link.error}</p>}
              <p className="font-medium text-kumo-strong">Link the phone of {DEVICE_NUMBER}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open WhatsApp on that phone.</li>
                <li>Go to Settings, then Linked devices.</li>
                <li>Tap Link a device and scan this code.</li>
              </ol>
              <p className="text-sm text-kumo-subtle">The code changes every 20 seconds. This page refreshes by itself.</p>
            </div>
            <AutoRefresh seconds={10} />
          </div>
        )}
        {messages.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-kumo-subtle">Latest messages</p>
            <ul className="flex flex-col divide-y divide-kumo-hairline rounded-md border border-kumo-hairline">
              {messages.map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                  <span className="w-28 shrink-0 text-kumo-subtle" title={utc(m.sentAt)}>
                    {relativeTime(m.sentAt, now)}
                  </span>
                  <span className="w-32 shrink-0 font-medium text-kumo-strong">{m.direction === "in" ? `From ${m.contactName}` : `To ${m.contactName}`}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {m.body ?? <span className="text-kumo-subtle">{m.kind === "voice" ? "Voice note, transcript pending" : m.kind}</span>}
                  </span>
                  {m.direction === "out" && m.delivery && <span className="shrink-0 text-kumo-subtle">{m.delivery}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
