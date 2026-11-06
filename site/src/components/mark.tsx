/**
 * The Dualis mark (Kevin 2026-11-06, option C "split seal"): a square frame cut on the diagonal, one half filled, the
 * D in the open half. Two sides of one name: long and short, price and value. Master: design/assets/Logos/dualis-mark.svg.
 */
export function Mark({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <rect x="12" y="12" width="232" height="232" fill="none" stroke="currentColor" strokeWidth="24" />
      <path d="M0 256 L256 0 L256 256 Z" fill="currentColor" />
      <path d="M54 48 V128 M54 48 H74 A40 40 0 0 1 74 128 H54" fill="none" stroke="currentColor" strokeWidth="17" strokeLinejoin="miter" />
    </svg>
  );
}
