import { day, price, signedPct } from "./format";

/** Company logo, or its initials on a tinted tile when no source has a logo. */
export function CompanyLogo({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-kumo-hairline" />
    );
  }
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-kumo-tint font-semibold text-kumo-subtle ring-1 ring-kumo-hairline"
    >
      {initials || "?"}
    </span>
  );
}

/** Day change in the Dualis data colours: green up, red down. */
export function DayChange({ ratio, className = "" }: { ratio: number | null; className?: string }) {
  if (ratio === null) return null;
  const tone = ratio > 0 ? "text-dualis-long" : ratio < 0 ? "text-dualis-short" : "text-kumo-subtle";
  return <span className={`font-mono tabular ${tone} ${className}`}>{signedPct(ratio)}</span>;
}

/** Last close, its change and the trading day it belongs to. */
export function LastPrice({ quote }: { quote: { close: number; changePct: number | null; currency: string | null; date: string } }) {
  return (
    <div className="flex flex-col items-end">
      <p className="font-mono text-xl font-semibold tabular text-kumo-strong">
        {price(quote.close)} <span className="text-sm font-normal text-kumo-subtle">{quote.currency}</span>
      </p>
      <p className="text-sm text-kumo-subtle">
        <DayChange ratio={quote.changePct} /> close of {day(quote.date)}
      </p>
    </div>
  );
}
