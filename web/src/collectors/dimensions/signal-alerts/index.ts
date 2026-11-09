import { and, eq, gte, inArray } from "drizzle-orm";
import { signalChanges } from "@/db/schema/analysis";
import type { BronzeFetch } from "@/db/schema/bronze";
import * as content from "@/db/schema/content";
import { whatsappLink } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { signalAlert } from "@/content/messages";
import { isUpgrade } from "@/content/signal-alert";
import { allowlist, normalizePhone } from "@/whatsapp/allowlist";
import { enqueue } from "@/whatsapp/outbox";
import type { Dimension, PromoteResult, Source } from "../../types";
import { type AlertInput, alertInput } from "./data";

/**
 * Signal Change alerts on WhatsApp (Kevin 2026-11-09): only when a signal gets BETTER (`isUpgrade`: no signal -> weak
 * or strong, weak -> strong, inflection <-> crack), to Kevin AND Thierry, each with one picture of the level B panel
 * (price vs fair value + the Narrative Drivers and their Status, `render.ts`) and the Update Note as caption.
 * Runs right after `signals` in every collect (GitHub Actions), never on the box.
 * Bronze = what the picture is drawn from (one fetch per change x recipient); silver.content_messages = one row per
 * queued message (purpose alert, transition_id = the Signal Change id); the outbox row holds the PNG.
 */

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const SIGNAL_ALERTS_DIMENSION = "signal-alerts";
export const ALERT_SOURCE = "signal-alerts";
export const ALERT_ROLES: readonly ("client" | "test")[] = ["test", "client"];
/** A change older than this is never sent (a run missed it: stale news). */
const MAX_AGE_HOURS = 24;

type Planned = { changeId: string; recipient: string; text: string; input: AlertInput };
const planned = new Map<string, Planned>();

export const alertPlan: Source = {
  name: ALERT_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject) {
    const p = planned.get(subject);
    if (!p) throw new Error(`no planned alert for ${subject}`);
    return { request: { subject }, httpStatus: null, payload: p };
  },
};

export const signalAlertsDim: Dimension = {
  name: SIGNAL_ALERTS_DIMENSION,
  description: "WhatsApp to Kevin and Thierry when a signal gets better (no signal -> weak / strong, weak -> strong, inflection <-> crack), with the chart and the drivers' Status in one picture.",
  sources: [alertPlan],
  subjects: planAlerts,
  promote: promoteAlerts,
};

function recipients(): string[] {
  const list = allowlist();
  for (const role of ALERT_ROLES) {
    if (!list.some((c) => c.role === role)) throw new Error(`no ${role} contact on the WhatsApp allowlist`);
  }
  return list.filter((c) => ALERT_ROLES.includes(c.role)).map((c) => normalizePhone(c.phone));
}

/** Every upgrade of the last day not yet queued for a recipient; nothing while the device is unlinked (a queue would burst once linked). */
export async function planAlerts(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  planned.clear();
  const [link] = await db.select({ status: whatsappLink.status }).from(whatsappLink).where(eq(whatsappLink.id, "default"));
  if (link?.status !== "linked") return [];
  const changes = (await db.select().from(signalChanges).where(gte(signalChanges.at, new Date(now.getTime() - MAX_AGE_HOURS * 3600_000)))).filter(isUpgrade);
  if (changes.length === 0) return [];
  const sent = await db
    .select({ transitionId: content.contentMessages.transitionId, recipient: content.contentMessages.recipient, sources: content.contentMessages.sources })
    .from(content.contentMessages)
    .where(inArray(content.contentMessages.transitionId, changes.map((c) => c.id)));
  const to = recipients();
  const out: string[] = [];
  for (const c of changes.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    // Already handled by the old text-only alert (content-dispatch, before 2026-11-09): never a second message.
    if (sent.some((s) => s.transitionId === c.id && !s.sources.includes(ALERT_SOURCE))) continue;
    const todo = to.filter((r) => !sent.some((s) => s.transitionId === c.id && s.recipient === r));
    if (todo.length === 0) continue;
    const input = await alertInput(db, c, now);
    const text = signalAlert(c, input.name);
    for (const recipient of todo) {
      const key = `signal:${c.id}:${recipient}`;
      planned.set(key, { changeId: c.id, recipient, text, input });
      out.push(key);
    }
  }
  return out;
}

/** Each planned alert -> one outbox row with its picture + one silver.content_messages row, once per bronze row. */
export async function promoteAlerts(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  const ok = rows.filter((r) => !r.error && r.source === ALERT_SOURCE);
  if (ok.length === 0) return { silverRowsBySource: { [ALERT_SOURCE]: 0 } };
  const done = new Set(
    (await db.select({ b: content.contentMessages.bronzeId }).from(content.contentMessages).where(inArray(content.contentMessages.bronzeId, ok.map((r) => r.id)))).map((r) => r.b),
  );
  const { alertPng } = (await nodeImport(new URL("./render.ts", import.meta.url).href)) as typeof import("./render");
  const pngs = new Map<string, Buffer>();
  for (const f of ok.filter((r) => !done.has(r.id))) {
    const p = f.payload as Planned;
    const [already] = await db
      .select({ id: content.contentMessages.outboxId })
      .from(content.contentMessages)
      .where(and(eq(content.contentMessages.transitionId, p.changeId), eq(content.contentMessages.recipient, p.recipient)));
    if (already) continue;
    const image = pngs.get(p.changeId) ?? alertPng(p.input);
    pngs.set(p.changeId, image);
    const row = await enqueue(db, { recipient: p.recipient, text: p.text, image, imageMime: "image/png", requestedBy: SIGNAL_ALERTS_DIMENSION });
    await db.insert(content.contentMessages).values({
      outboxId: row.id,
      bronzeId: f.id,
      purpose: "alert",
      transitionId: p.changeId,
      recipient: row.recipient,
      scheduledAt: row.scheduledAt,
      sources: [ALERT_SOURCE],
    });
    n += 1;
  }
  return { silverRowsBySource: { [ALERT_SOURCE]: n } };
}
