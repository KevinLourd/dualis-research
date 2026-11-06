import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { goldWhatsappConversation, whatsappLink } from "@/db/schema/whatsapp";

/** Settings > WhatsApp: the device's link health (ops) and the latest messages (gold). */
export async function getWhatsappLink() {
  const [row] = await getDb().select().from(whatsappLink).where(eq(whatsappLink.id, "default"));
  return row ?? null;
}

export async function latestWhatsappMessages(limit = 8) {
  return getDb().select().from(goldWhatsappConversation).orderBy(desc(goldWhatsappConversation.sentAt)).limit(limit);
}
