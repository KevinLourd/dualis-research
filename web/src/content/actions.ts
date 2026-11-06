"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { type DraftStatus, setDraftStatus } from "./manual";

const STATUSES: DraftStatus[] = ["draft", "approved", "posted", "dismissed"];

export async function updateDraftStatus(formData: FormData) {
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as DraftStatus;
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
  await setDraftStatus(getDb(), id, status, { postedUrl: formData.get("postedUrl")?.toString() ?? null, userId });
  revalidatePath("/content");
}
