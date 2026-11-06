import { SealWatermark } from "./mark";

/** Price follows the narrative; value follows the business. The gap is the trade (Thierry's method, 2026-11-04). */
export function NarrativeFigure() {
  return (
    <svg className="figure-narrative" viewBox="0 0 520 380" role="img" aria-label="Market price swinging around fundamental value">
      <rect width="520" height="380" className="fn-bg" />
      <SealWatermark w={520} h={380} />
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

/** The split disc as a diagram: one shape, two directions. */
export function BothWaysFigure() {
  return (
    <svg className="figure-both" viewBox="0 0 360 300" role="img" aria-label="Long and short ideas from the same method">
      <text x="180" y="28" textAnchor="middle" className="fb-label">METHOD</text>
      <circle cx="180" cy="62" r="10" className="fb-dot pop" />
      <line x1="172" y1="70" x2="70" y2="232" className="fb-line draw" pathLength={1} markerEnd="url(#fb-arrow)" style={{ ["--d" as string]: "0.3s" }} />
      <line x1="188" y1="70" x2="290" y2="232" className="fb-line draw" pathLength={1} markerEnd="url(#fb-arrow)" style={{ ["--d" as string]: "0.45s" }} />
      <line x1="84" y1="244" x2="276" y2="244" className="fb-line fb-dash late" style={{ ["--d" as string]: "1.2s" }} />
      <circle cx="64" cy="244" r="10" className="fb-dot pop" style={{ ["--d" as string]: "1s" }} />
      <circle cx="296" cy="244" r="10" className="fb-dot pop" style={{ ["--d" as string]: "1.1s" }} />
      <text x="64" y="282" textAnchor="middle" className="fb-label">LONG</text>
      <text x="296" y="282" textAnchor="middle" className="fb-label">SHORT</text>
      <defs>
        <marker id="fb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="fb-head" />
        </marker>
      </defs>
    </svg>
  );
}
