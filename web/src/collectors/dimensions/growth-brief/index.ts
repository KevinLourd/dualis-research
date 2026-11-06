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
 * Kevin only for now (« moi seulement pour now »): switching to Thierry = `RECIPIENT_ROLE = "client"`.
 */

const nodeImport = (href: string): Promise<unknown> => import(/* webpackIgnore: true */ href);

export const GROWTH_BRIEF_DIMENSION = "growth-brief";
export const BRIEF_SOURCE = "growth";
export const RECIPIENT_ROLE: "client" | "test" = "test";
/** 08:00 in Astana (UTC+5) = 03:00 UTC. */
const SEND_HOUR_UTC = 3;

type Planned = { recipient: string; scheduledAt: string; text: string; brief: GrowthBrief };
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

function recipient(): string {
  const c = allowlist().find((x) => x.role === RECIPIENT_ROLE);
  if (!c) throw new Error(`no ${RECIPIENT_ROLE} contact on the WhatsApp allowlist`);
  return c.phone;
}

/** 08:00 Astana on `day`. */
const sendAt = (day: string) => new Date(`${day}T${String(SEND_HOUR_UTC).padStart(2, "0")}:00:00Z`);

async function alreadyQueued(db: Db, day: string): Promise<boolean> {
  const at = sendAt(day);
  const [row] = await db
    .select({ id: whatsappOutbox.id })
    .from(whatsappOutbox)
    .where(and(eq(whatsappOutbox.requestedBy, GROWTH_BRIEF_DIMENSION), gte(whatsappOutbox.scheduledAt, at), lt(whatsappOutbox.scheduledAt, new Date(at.getTime() + 86_400_000))))
    .limit(1);
  return !!row;
}

/** Today's brief (Astana day), unless it is already queued or the device is unlinked (a queue would burst once linked). */
export async function planBrief(db: Db, _ctx?: unknown, now = new Date()): Promise<string[]> {
  planned.clear();
  const [link] = await db.select({ status: whatsappLink.status }).from(whatsappLink).where(eq(whatsappLink.id, "default"));
  if (link?.status !== "linked") return [];
  const today = astanaDay(now);
  if (await alreadyQueued(db, today)) return [];
  const [audience, outreach] = await Promise.all([
    db.select({ date: goldGrowthAudience.date, subscribers: goldGrowthAudience.subscribers }).from(goldGrowthAudience).orderBy(asc(goldGrowthAudience.date)),
    db.select().from(goldGrowthOutreach),
  ]);
  const brief = growthBrief(audience, outreach.map((o) => ({ outreach: o })), today);
  const key = `brief:${today}`;
  planned.set(key, { recipient: recipient(), scheduledAt: new Date(Math.max(sendAt(today).getTime(), now.getTime())).toISOString(), text: briefText(brief), brief });
  return [key];
}

/** The planned brief -> one app.whatsapp_outbox row with the chart PNG. Once per Astana day. */
export async function promoteBrief(db: Db, rows: BronzeFetch[]): Promise<PromoteResult> {
  let n = 0;
  for (const f of rows.filter((r) => !r.error && r.source === BRIEF_SOURCE)) {
    const p = f.payload as Planned;
    if (await alreadyQueued(db, p.brief.date)) continue;
    const { briefChartPng } = (await nodeImport(new URL("./render.ts", import.meta.url).href)) as typeof import("./render");
    await enqueue(db, {
      recipient: p.recipient,
      text: p.text,
      image: briefChartPng(p.brief),
      imageMime: "image/png",
      scheduledAt: new Date(p.scheduledAt),
      requestedBy: GROWTH_BRIEF_DIMENSION,
    });
    n += 1;
  }
  return { silverRowsBySource: { [BRIEF_SOURCE]: n } };
}
