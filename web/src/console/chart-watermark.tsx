/**
 * The Dualis seal as a faint watermark over an exhibit chart (Kevin 2026-11-06, like Citrini's charts): the brand
 * mark sits behind every number we publish. Pointer events pass through to the chart.
 */
export function ChartWatermark({ dark }: { dark: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dark ? "/brand/seal-white.svg" : "/brand/seal.svg"}
      alt=""
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] max-h-[220px] w-auto -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.06]"
    />
  );
}
