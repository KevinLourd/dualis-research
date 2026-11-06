/**
 * The Dualis mark (Kevin 2026-11-05): the D of Dualis, split by a price line that dips, then turns up. Two sides in
 * one letter, and the moment a narrative turns. Master: design/assets/Logos/dualis-mark.svg.
 */
export function Mark({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <g transform="translate(-8 0)">
        <path d="M60 44 H128 A84 84 0 0 1 128 212 H60 Z" fill="none" stroke="currentColor" strokeWidth="26" strokeLinejoin="miter" />
        <path d="M60 212 L108 164 L123.42 179.42 L187.4 68.6 A84 84 0 0 1 128 212 Z" fill="currentColor" />
      </g>
    </svg>
  );
}
