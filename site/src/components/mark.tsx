/**
 * The Dualis mark (Kevin 2026-11-06, round 2 option 02 "Guilloche"): a Roman D inside a banknote rosette, two families
 * of waves crossing around it. `mark` = the simplified version (header, footer, covers, icons); `/brand/seal*.svg` =
 * the detailed version (chart watermark, large uses). Masters: design/assets/Logos/.
 */
export function Mark({ tone = "indigo", title }: { tone?: "indigo" | "white"; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mark" src={tone === "white" ? "/brand/mark-white.svg" : "/brand/mark.svg"} alt={title ?? ""} aria-hidden={title ? undefined : true} width={256} height={256} />
  );
}

/**
 * The detailed seal as a faint watermark behind a dark chart (Kevin 2026-11-06, like Citrini's charts): drop it inside
 * an SVG chart, after the background. Centred in a w x h box.
 */
export function SealWatermark({ w, h, size = 0.62 }: { w: number; h: number; size?: number }) {
  const s = Math.min(w, h) * size;
  return <image href="/brand/seal-white.svg" x={(w - s) / 2} y={(h - s) / 2} width={s} height={s} opacity={0.07} aria-hidden="true" />;
}
