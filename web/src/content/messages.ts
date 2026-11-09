import { FORMAT_LABEL, publishLink } from "@/collectors/dimensions/content-drafts/format";
import type { GoldContentDraft } from "@/db/schema/content";
import { allowlist } from "@/whatsapp/allowlist";
import { signalWords } from "./signal-words";

/** Pure WhatsApp texts the content dimensions send Thierry (the service adds the "Dualis Research" line on top). */

export const CONSOLE_URL = process.env.CONSOLE_URL ?? "https://dualis-console.dualis-research.workers.dev";

/** The client on the allowlist: drafts and alerts go to him, tests go to the test contact. */
export function clientPhone(): string {
  const c = allowlist().find((x) => x.role === "client");
  if (!c) throw new Error("no client on the WhatsApp allowlist");
  return c.phone;
}

/**
 * Who the daily posts go to (drafts, new versions, publish links) and whose answers drive the loop. Kevin only while
 * we test (« test »); switching to Thierry = "client", on Kevin's go.
 */
export const POST_LOOP_ROLE: "client" | "test" = "test";

export function postLoopPhone(): string {
  const c = allowlist().find((x) => x.role === POST_LOOP_ROLE);
  if (!c) throw new Error(`no ${POST_LOOP_ROLE} contact on the WhatsApp allowlist`);
  return c.phone;
}

const ASK = "Reply go to post it, or tell me what to change (text or voice).";

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
  if (d.format === "substack-note") {
    return ["Approved. Copy the text below, open Substack Notes, paste it and add the image from my draft message:", "https://substack.com/notes", "", d.body].join("\n");
  }
  const link = publishLink(d.format, d.body);
  const image = d.format === "x-post" ? " The text is filled in: add the image from my draft message, then post." : "";
  return `Approved. ${link?.label ?? "Publish"} in one tap: ${link?.href ?? `${CONSOLE_URL}/content`}${image}`;
}

/** A Signal Change: the new signal, its one-line Update Note, the page that shows why. */
export function signalAlert(c: { symbol: string; fromSignal: string; fromStrength: string; toSignal: string; toStrength: string; updateNote: string | null }, name: string | null): string {
  return [
    `*${c.symbol}*${name ? ` (${name})` : ""}: ${signalWords(c.toSignal, c.toStrength)}, was ${signalWords(c.fromSignal, c.fromStrength)}.`,
    c.updateNote ?? "",
    `Why: ${CONSOLE_URL}/tickers/${encodeURIComponent(c.symbol)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
