/**
 * The Dualis mark (Kevin 2026-11-06, round 2 option 03): Solomon's knot, two loops that cannot be pulled apart (price
 * and value, long and short). `mark` = the simplified version (header, footer, covers, icons); `/brand/seal*.svg` = the
 * detailed engraved version (the Research framework drawn on it, large uses). Masters: design/assets/Logos/.
 */
export function Mark({ tone = "indigo", title }: { tone?: "indigo" | "white"; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mark" src={tone === "white" ? "/brand/mark-white.svg" : "/brand/mark.svg"} alt={title ?? ""} aria-hidden={title ? undefined : true} width={256} height={256} />
  );
}
