"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { dispatchWorkflow } from "@/content/dispatch";
import { checkColorEdit } from "./color";

/**
 * A colour edit from the Design system page. The console never writes git itself: it starts design-edit.yml, which
 * sets the value in design/tokens.json, regenerates the site and console files, commits to main and redeploys the
 * site. Same source as a Claude Code PR, so both land in one file.
 */
export async function saveColor(name: string, light: string, dark: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to edit the design system");
  const edit = checkColorEdit({ name, light, dark });
  const user = await currentUser();
  await dispatchWorkflow("design-edit.yml", { ...edit, author: user?.firstName || "the console" });
}
