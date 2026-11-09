"use client";

import { Tabs } from "@cloudflare/kumo";
import { useRouter } from "next/navigation";
import { STRATEGIES, type StrategyId } from "./live-test";

/** One tab per strategy, kept in the URL (`?strategy=`) so the view is linkable. */
export function LiveTestTabs({ value }: { value: StrategyId }) {
  const router = useRouter();
  return (
    <Tabs
      variant="underline"
      value={value}
      onValueChange={(v) => router.replace(v === "all" ? "/live-test" : `/live-test?strategy=${v}`, { scroll: false })}
      tabs={(Object.keys(STRATEGIES) as StrategyId[]).map((id) => ({ value: id, label: STRATEGIES[id].label }))}
    />
  );
}
