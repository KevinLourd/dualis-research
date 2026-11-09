import { UserButton } from "@clerk/nextjs";
import Link from "@/console/link";
import { KSidebarTrigger } from "./kumo";
import { relativeTime, utc } from "./format";
import { type PaletteTicker, TickerSearch } from "./command-palette";
import type { listRuns } from "./queries";
import { RunStatus } from "./ui";

type Run = Awaited<ReturnType<typeof listRuns>>[number];

export function TopBar({ tickers, lastRun }: { tickers: PaletteTicker[]; lastRun: Run | null }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-kumo-hairline bg-kumo-base px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Phone: opens the sidebar sheet (Kumo renders it as a dialog below 768 px). */}
        <span className="md:hidden">
          <KSidebarTrigger />
        </span>
        <TickerSearch tickers={tickers} />
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Link
          href="/data"
          className="hidden items-center gap-2 text-sm text-kumo-subtle hover:text-kumo-default sm:flex"
          title={lastRun ? `Last collection ${utc(lastRun.startedAt)}` : undefined}
        >
          {lastRun ? (
            <>
              <RunStatus status={lastRun.status} />
              <span className="hidden md:inline">
                {lastRun.dimension} · {relativeTime(lastRun.startedAt)}
              </span>
            </>
          ) : (
            <span>No collection yet</span>
          )}
        </Link>
        <UserButton />
      </div>
    </header>
  );
}
