import { FORMAT_LABEL, publishLink } from "@/collectors/dimensions/content-drafts/format";
import type { GoldContentDraft } from "@/db/schema/content";
import { allowlist } from "@/whatsapp/allowlist";
import { signalHeadline } from "./signal-words";

/** Pure WhatsApp texts the content dimensions send Thierry (the service adds the "Dualis Research" line on top). */

export const CONSOLE_URL = process.env.CONSOLE_URL ?? "https://dualis-console.dualis-research.workers.dev";

/** The client on the allowlist: drafts and alerts go to him, tests go to the test contact. */
export function clientPhone(): string {
  const c = allowlist().find((x) => x.role === "client");
  if (!c) throw new Error("no client on the WhatsApp allowlist");
  return c.phone;
}

const ASK = "Reply OK to post it, or tell me what to change (text or voice).";

function header(d: Pick<GoldContentDraft, "format" | "accountName" | "symbol">): string {
  return `*${FORMAT_LABEL[d.format] ?? d.format}* · ${d.accountName ?? "no account yet"} · ${d.symbol}`;
}

/** A draft at its slot: the full text for short formats, the title and preview link for an article. */
export function draftMessage(d: GoldContentDraft, version = false): string {
  const top = version ? `Updated, ${header(d)}` : header(d);
  if (d.format === "substack-article") {
    return [top, "", `*${d.title ?? ""}*`, "", `Full article with its charts: ${CONSOLE_URL}/content/drafts/${d.id}`, "", ASK].join("\n");
  }
  return [top, "", d.body, "", ASK].join("\n");
}

/** After his OK: the one-click way to publish on that channel ($0: no paid API). */
export function publishMessage(d: GoldContentDraft): string {
  if (d.format === "substack-article") return `Approved. Copy it into the Substack editor from here: ${CONSOLE_URL}/content/drafts/${d.id}`;
  if (d.format === "substack-note") return ["Approved. Paste it in Substack Notes (https://substack.com/notes):", "", d.body].join("\n");
  const link = publishLink(d.format, d.body);
  return `Approved. ${link?.label ?? "Publish"} in one click: ${link?.href ?? `${CONSOLE_URL}/content`}`;
}

/** A signal: the narrative on a ticker cracked (or turned on a long), why, the sentence that weighed most, the why page. */
export function alertMessage(
  t: { symbol: string; fromState: string; toState: string; reason: string | null; citedEvidence: string | null; id: string },
  position: string | null,
): string {
  return [
    signalHeadline(t.symbol, t.toState, position),
    t.reason ?? "",
    t.citedEvidence ? `Evidence: ${t.citedEvidence}` : "",
    `Why: ${CONSOLE_URL}/tickers/${encodeURIComponent(t.symbol)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
