"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { whatsappLink } from "@/db/schema/whatsapp";
import { withWriteDb } from "@/db/write";
import { pairingPhone } from "./pairing";

/** Settings: link with a code instead of the QR. The WhatsApp service sees the request within seconds and writes the code back. */
export async function requestPairingCode(formData: FormData) {
  await auth.protect();
  const phone = pairingPhone(String(formData.get("phone") ?? ""));
  const now = new Date();
  await withWriteDb((db) =>
    db
      .insert(whatsappLink)
      .values({ id: "default", status: "waiting-for-scan", pairingPhone: phone, pairingRequestedAt: now, pairingCode: null })
      .onConflictDoUpdate({ target: whatsappLink.id, set: { pairingPhone: phone, pairingRequestedAt: now, pairingCode: null } }),
  );
  revalidatePath("/settings");
}
