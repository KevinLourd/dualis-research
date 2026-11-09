import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { BronzeFetch } from "@/db/schema/bronze";
import { goldGrowthAudience, goldGrowthOutreach } from "@/db/schema/growth";
import { whatsappLink, whatsappOutbox } from "@/db/schema/whatsapp";
import type { Db } from "@/db/types";
import { astanaDay, briefText, type GrowthBrief, growthBrief } from "@/growth/daily";
import { allowlist } from "@/whatsapp/allowlist";
import { enqueue } from "@/whatsapp/outbox";
import type { Dimension, PromoteResult, Source } from "../../types";

/**
 * The morning Growth brief (Kevin 2026-11-06): one WhatsApp message a day at 08:00 Astana, the Growth page's key
 * figures + its subscribers chart as an image. Same gold rows and formulas as the page (`growth/daily.ts`).
 * Sent to Kevin AND Thierry (call 2026-11-06, Kevin: « a daily update to both of us so we can track subscribers »):
 * every allowlisted contact of `RECIPIENT_ROLES`, one outbox row each, once per Astana day per recipient.
 */

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const GROWTH_BRIEF_DIMENSION = "growth-brief";
export const BRIEF_SOURCE = "growth";
export const RECIPIENT_ROLES: readonly ("client" | "test")[] = ["test", "client"];
/** 08:00 in Astana (UTC+5) = 03:00 UTC. */
const SEND_HOUR_UTC = 3;

type Planned = { recipients: string[]; scheduledAt: string; text: string; brief: GrowthBrief };
const planned = new Map<string, Planned>();

/** Builds the brief from gold; no external call. The figures land in bronze like any fetch. */
export const briefPlan: Source = {
  name: BRIEF_SOURCE,
  requiredEnv: [],
  covers: () => true,
  async fetch(subject) {
    const p = planned.get(subject);
    if (!p) throw new Error(`no planned brief for ${subject}`);
    return { request: { subject }, httpStatus: null, payload: p };
  },
};

export const growthBriefDim: Dimension = {
  name: GROWTH_BRIEF_DIMENSION,
  description: "Morning WhatsApp: the Growth page's key figures and its subscribers chart, once a day at 08:00 Astana.",
  sources: [briefPlan],
  subjects: planBrief,
  promote: promoteBrief,
};

/** Every brief recipient; each role must have at least one contact (fails loud, never a silent half-send). */
function recipients(): string[] {
  const list = allowlist();
  for (const role of RECIPIENT_ROLES) {
    if (!list.some((c) => c.role === role)) throw new Error(`no ${role} contact on the WhatsApp allowlist`);
  }
  return list.filter((c) => RECIPIENT_ROLES.includes(c.role)).map((c) => c.phone);
}

/** 08:00 Astana on `day`. */
const sendAt = (day: string) => new Date(`${day}T${String(SEND_HOUR_UTC).padStart(2, "0")}:00:00Z`);

/** Recipients already holding `day`'s brief in the outbox. */
async function queuedFor(db: Db, day: string): Promise<Set<string>> {
  const at = sendAt(day);
  const rows = await db
    .select({ recipient: whatsappOutbox.recipient })
    .from(whatsappOutbox)
    .where(and(eq(whatsappOutbox.requestedBy, GROWTH_BRIEF_DIMENSION), gte(whatsappOutbox.scheduledAt, at), lt(whatsappOutbox.scheduledAt, new Date(at.getTime() + 86_400_000))));
  return new Set(rows.map((r) => r.recipient));
}

/** Today's brief (Astana day) for every recipient not queued yet, unless the device is unlinked (a queue would burst once linked). */
export async function planBrief(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  planned.clear();
  const [link] = await db.select({ status: whatsappLink.status }).from(whatsappLink).where(eq(whatsappLink.id, "default"));
  if (link?.status !== "linked") return [];
  const today = astanaDay(now);
  const queued = await queuedFor(db, today);
  // A recipient added after today's 08:00 brief went to the others waits for tomorrow's (never a late, lone send).
  if (queued.size > 0 && now >= sendAt(today)) return [];
  const todo = recipients().filter((r) => !queued.has(r));
  if (todo.length === 0) return [];
  const [audience, outreach] = await Promise.all([
    db.select({ date: goldGrowthAudience.date, subscribers: goldGrowthAudience.subscribers }).from(goldGrowthAudience).orderBy(asc(goldGrowthAudience.date)),
    db.select().from(goldGrowthOutreach),
  ]);
  const brief = growthBrief(audience, outreach.map((o) => ({ outreach: o })), today);
  const key = `brief:${today}`;
  planned.set(key, { recipients: todo, scheduledAt: new Date(Math.max(sendAt(today).getTime(), now.getTime())).toISOString(), text: briefText(brief), brief });
  return [key];
}

/** The planned brief -> one app.whatsapp_outbox row per recipient with the chart PNG. Once per Astana day per recipient. */
export async function promoteBrief(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => !r.error && r.source === BRIEF_SOURCE)) {
    const p = f.payload as Planned;
    const queued = await queuedFor(db, p.brief.date);
    const todo = p.recipients.filter((r) => !queued.has(r));
    if (todo.length === 0) continue;
    const { briefChartPng } = (await nodeImport(new URL("./render.ts", import.meta.url).href)) as typeof import("./render");
    const image = briefChartPng(p.brief);
    for (const recipient of todo) {
      await enqueue(db, { recipient, text: p.text, image, imageMime: "image/png", scheduledAt: new Date(p.scheduledAt), requestedBy: GROWTH_BRIEF_DIMENSION });
      n += 1;
    }
  }
  return { silverRowsBySource: { [BRIEF_SOURCE]: n } };
}
