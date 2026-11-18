/**
 * Two figures for Investment Process, with no words (Kevin 2026-11-18, after Thierry's file of 2026-11-17).
 * Dispersion: one small dense circle that widens and fades, again and again: the wider the range of outcomes, the
 * paler. Asymmetry: two axes; above the horizontal one a dense surface that grows with time (large returns from a
 * narrow range of outcomes), below it a pale, shallower one (the losses of a wide range). Shapes only, no data.
 */
export function DispersionFigure() {
  return (
    <svg className="edge-figure" viewBox="0 0 540 260" role="img" aria-label="A small dense circle widens and fades as the range of outcomes grows">
      <circle className="ef-disperse" cx="270" cy="130" r="120" fill="var(--brand)" />
    </svg>
  );
}

export function AsymmetryFigure() {
  return (
    <svg className="edge-figure" viewBox="0 0 540 260" role="img" aria-label="Returns above the axis grow dense and large over time, losses below it stay pale and shallow">
      <path d="M70 165C230 158 380 110 510 22V165Z" fill="var(--brand)" />
      <path d="M70 165C240 170 390 190 510 222V165Z" fill="var(--brand)" fillOpacity="0.16" />
      <path d="M70 14V246M70 165H524" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}
