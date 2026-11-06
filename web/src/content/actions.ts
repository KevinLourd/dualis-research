"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { DraftFormat } from "@/collectors/dimensions/content-drafts/format";
import { dispatchDraftWriter } from "./dispatch";
import { type DraftStatus, requestDraft, setDraftStatus } from "./manual";

const STATUSES: DraftStatus[] = ["draft", "approved", "posted", "dismissed"];

export async function updateDraftStatus(formData: FormData) {
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as DraftStatus;
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
  await setDraftStatus(getDb(), id, status, { postedUrl: formData.get("postedUrl")?.toString() ?? null, userId });
  revalidatePath("/content", "layout");
}

/** Create draft (Ideas panel): records the request, then starts the writer in GitHub Actions. */
export async function requestDraftAction(formData: FormData) {
  const { userId } = await auth.protect();
  const ideaId = String(formData.get("ideaId"));
  const format = String(formData.get("format")) as DraftFormat;
  await requestDraft(getDb(), ideaId, format, userId);
  await dispatchDraftWriter();
  revalidatePath("/content", "layout");
}
