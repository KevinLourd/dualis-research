"use client";

import { Tabs } from "@cloudflare/kumo";
import { useRouter } from "next/navigation";

/** Weak / Noise / Inactive tabs under the Strong table, kept in the URL (`?tab=`) so the view is linkable. */
export function BoardTabs({ value, weak, noise, inactive }: { value: "weak" | "noise" | "inactive"; weak: number; noise: number; inactive: number }) {
  const router = useRouter();
  return (
    <Tabs
      variant="underline"
      value={value}
      onValueChange={(v) => router.replace(v === "weak" ? "/" : `/?tab=${v}`, { scroll: false })}
      tabs={[
        { value: "weak", label: `Weak · ${weak}` },
        { value: "noise", label: `Noise · ${noise}` },
        { value: "inactive", label: `Inactive · ${inactive}` },
      ]}
    />
  );
}
