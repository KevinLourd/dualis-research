import { KBreadcrumbs, KBreadcrumbsCurrent, KBreadcrumbsLink, KBreadcrumbsSeparator } from "@/console/kumo";
import { notFound } from "next/navigation";
import { getTicker } from "@/console/queries";
import { CompanyLogo, LastPrice } from "@/console/market";
import { PositionTags } from "@/console/ui";

export default async function TickerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent((await params).symbol);
  const data = await getTicker(symbol);
  if (!data) notFound();
  const { ticker, profile, quote } = data;
  return (
    <>
      <div className="flex flex-col gap-3">
        <KBreadcrumbs>
          <KBreadcrumbsLink href="/tickers">Tickers</KBreadcrumbsLink>
          <KBreadcrumbsSeparator />
          <KBreadcrumbsCurrent>{ticker.symbol}</KBreadcrumbsCurrent>
        </KBreadcrumbs>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <CompanyLogo src={profile?.logoUrl ?? null} name={profile?.name ?? ticker.symbol} size={48} />
            <div className="min-w-0">
              <p className="font-mono text-[13px] font-semibold text-kumo-subtle">
                {ticker.symbol}
                {profile?.exchange && <span className="font-sans font-normal"> · {profile.exchange}</span>}
              </p>
              <h1 className="text-2xl font-semibold break-words text-kumo-strong">{profile?.name ?? ticker.symbol}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {quote && <LastPrice quote={{ ...quote, currency: quote.currency ?? profile?.currency ?? null }} />}
            <PositionTags inPortfolio={ticker.inPortfolio} position={ticker.position} />
          </div>
        </header>
      </div>
      {children}
    </>
  );
}
