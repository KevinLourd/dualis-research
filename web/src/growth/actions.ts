"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { withWriteDb } from "@/db/write";
import type { OutreachStatus } from "@/db/schema/growth";
import { recordOutreachEdit } from "./manual";

export async function saveOutreachMessage(formData: FormData) {
  const { userId } = await auth.protect();
  const handle = String(formData.get("handle"));
  const body = String(formData.get("body") ?? "");
  await withWriteDb((db) => recordOutreachEdit(db, handle, { body, userId }));
  revalidatePath("/growth");
}

export async function updateOutreachStatus(formData: FormData) {
  const { userId } = await auth.protect();
  const handle = String(formData.get("handle"));
  const status = String(formData.get("status")) as OutreachStatus;
  await withWriteDb((db) => recordOutreachEdit(db, handle, { status, userId }));
  revalidatePath("/growth");
}
