/**
 * Two plain figures for Company (Thierry 2026-11-17). Dispersion: circles that widen and fade, the wider the range of
 * outcomes the paler. Asymmetry: the upside block several times the downside block. Shapes only, no data.
 */
export function DispersionFigure() {
  const circles = [
    { cx: 40, r: 14, o: 1 },
    { cx: 104, r: 26, o: 0.6 },
    { cx: 192, r: 40, o: 0.34 },
    { cx: 306, r: 56, o: 0.18 },
    { cx: 452, r: 74, o: 0.08 },
  ];
  return (
    <svg className="edge-figure" viewBox="0 0 540 200" role="img" aria-label="Circles that widen and fade as the range of outcomes grows">
      {circles.map((c) => (
        <circle key={c.cx} cx={c.cx} cy="86" r={c.r} fill="var(--brand)" fillOpacity={c.o} stroke="var(--brand)" strokeOpacity={Math.max(c.o, 0.3)} />
      ))}
      <path d="M26 184h488m-8-5 8 5-8 5" fill="none" stroke="var(--muted)" />
      <text x="26" y="176" className="ef-label">
        Narrow range of outcomes
      </text>
      <text x="514" y="176" textAnchor="end" className="ef-label">
        Wide range
      </text>
    </svg>
  );
}

export function AsymmetryFigure() {
  return (
    <svg className="edge-figure" viewBox="0 0 540 240" role="img" aria-label="An upside several times larger than the downside">
      <path d="M150 20h170v140H150z" fill="var(--brand)" />
      <path d="M150 160h170v36H150z" fill="var(--brand)" fillOpacity="0.16" stroke="var(--brand)" strokeOpacity="0.4" />
      <path d="M90 160h300" stroke="var(--ink)" />
      <text x="340" y="94" className="ef-label ef-strong">
        Upside
      </text>
      <text x="340" y="183" className="ef-label">
        Downside
      </text>
      <text x="90" y="152" className="ef-label">
        Entry
      </text>
    </svg>
  );
}
