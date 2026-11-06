import { SidebarProvider } from "@/console/kumo";
import { auth } from "@clerk/nextjs/server";
import { AppSidebar } from "@/console/app-sidebar";
import { lastRun, listTickers } from "@/console/queries";
import { TopBar } from "@/console/top-bar";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Resource-level check on top of the middleware: no console data is read for a signed-out request.
  await auth.protect();
  const [tickers, run] = await Promise.all([listTickers(), lastRun()]);
  return (
    <SidebarProvider defaultOpen collapsible="icon" className="h-svh">
      <AppSidebar />
      <div className="flex h-svh min-w-0 flex-1 flex-col overflow-y-auto bg-kumo-canvas">
        <TopBar
          tickers={tickers.map((t) => ({ symbol: t.symbol, name: t.name, market: t.market, inPortfolio: t.inPortfolio, aliases: t.aliases }))}
          lastRun={run}
        />
        <main className="mx-auto flex w-full max-w-[1200px] shrink-0 flex-col gap-6 px-8 pt-8 pb-16">{children}</main>
      </div>
    </SidebarProvider>
  );
}
