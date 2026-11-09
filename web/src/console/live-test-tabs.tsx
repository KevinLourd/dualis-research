"use client";

import { Tabs } from "@cloudflare/kumo";
import { useRouter } from "next/navigation";

export type LiveTab = "open" | "closed" | "history";

/** Open positions (default), closed positions, signal history; kept in the URL (`?tab=`) so the view is linkable. */
export function LiveTestTabs({ value, open, closed, history }: { value: LiveTab; open: number; closed: number; history: number }) {
  const router = useRouter();
  return (
    <Tabs
      variant="underline"
      value={value}
      onValueChange={(v) => router.replace(v === "open" ? "/live-test" : `/live-test?tab=${v}`, { scroll: false })}
      tabs={[
        { value: "open", label: `Open · ${open}` },
        { value: "closed", label: `Closed · ${closed}` },
        { value: "history", label: `Signal history · ${history}` },
      ]}
    />
  );
}
