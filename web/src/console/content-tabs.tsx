"use client";

import { Tabs } from "@cloudflare/kumo";
import { usePathname, useRouter } from "next/navigation";

/** Content sub-pages: Ideas (what to publish next) and Drafts (every draft written from them). */
export function ContentTabs({ ideas, drafts }: { ideas: number; drafts: number }) {
  const router = useRouter();
  const path = usePathname();
  const value = path.startsWith("/content/drafts") ? "drafts" : "ideas";
  return (
    <Tabs
      variant="underline"
      value={value}
      onValueChange={(v) => router.push(v === "ideas" ? "/content" : "/content/drafts", { scroll: false })}
      tabs={[
        { value: "ideas", label: `Ideas · ${ideas}` },
        { value: "drafts", label: `Drafts · ${drafts}` },
      ]}
    />
  );
}
