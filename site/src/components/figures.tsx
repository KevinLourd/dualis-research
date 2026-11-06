/** Price follows the narrative; value follows the business. The gap is the trade (Thierry's method, 2026-11-04). */
export function NarrativeFigure() {
  return (
    <svg className="figure-narrative" viewBox="0 0 520 380" role="img" aria-label="Market price swinging around fundamental value">
      <rect width="520" height="380" className="fn-bg" />
      {[80, 150, 220, 290].map((y) => (
        <line key={y} x1="40" x2="490" y1={y} y2={y} className="fn-grid" />
      ))}
      <path d="M40 250 C 110 245, 160 230, 230 215 S 360 190, 490 160" className="fn-value draw-fade" />
      <path d="M40 200 C 90 120, 130 100, 170 140 S 220 300, 270 310 S 330 250, 360 190 S 430 60, 490 90" className="fn-price draw" pathLength={1} />
      <circle cx="268" cy="309" r="6" className="fn-long pop" style={{ ["--d" as string]: "1.3s" }} />
      <circle cx="455" cy="70" r="6" className="fn-short pop" style={{ ["--d" as string]: "1.7s" }} />
      <text x="282" y="334" className="fn-label late" style={{ ["--d" as string]: "1.5s" }}>Long: the bad story turns</text>
      <text x="300" y="52" className="fn-label late" style={{ ["--d" as string]: "1.9s" }}>Short: the hype cracks</text>
      <g transform="translate(40 30)">
        <line x1="0" x2="18" y1="-4" y2="-4" className="fn-price" />
        <text x="26" y="0" className="fn-legend">Market price (the narrative)</text>
        <line x1="230" x2="248" y1="-4" y2="-4" className="fn-value" />
        <text x="256" y="0" className="fn-legend">Fundamental value</text>
      </g>
    </svg>
  );
}
