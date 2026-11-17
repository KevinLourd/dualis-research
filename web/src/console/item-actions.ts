"use server";

import { auth } from "@clerk/nextjs/server";
import { itemView } from "./item-detail";

/**
 * One item panel of the Analysis page (level C), rendered ALONE: opening a panel no longer re-renders the whole
 * Analysis page behind it (2026-11-17: each panel click and each hover pre-load rendered the full page, ~100-500 ms of
 * CPU on the Workers free plan, and the fair-value panel answered 1102). `item-nav.ts` calls it.
 */
export async function loadItemPanel(symbol: string, item: string, thesis: "long" | "short" | null) {
  const { userId } = await auth();
  if (!userId) throw new Error("Signed out");
  const view = await itemView(symbol, item, thesis);
  return view && { title: view.title, subtitle: view.subtitle ?? null, body: view.body };
}
