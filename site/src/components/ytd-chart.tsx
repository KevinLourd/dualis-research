import { YTD_SERIES } from "@/lib/track-record";

/**
 * The portfolio vs the S&P 500 since January 1, in the light chart style of design/tokens.json (white ground, light
 * gridlines; Thierry 2026-11-06: « a white background with a purple »): the curve of his own published chart, redrawn.
 * Indigo = portfolio, grey = S&P 500.
 */
export function YtdChart({ source }: { source: string }) {
  const W = 640;
  const H = 360;
  const left = 52;
  const right = 64;
  const top = 56;
  const bottom = 36;
  const values = YTD_SERIES.flatMap(([, a, b]) => [a, b]);
  const lo = Math.floor(Math.min(...values) / 20) * 20;
  const hi = Math.ceil(Math.max(...values) / 20) * 20;
  const t0 = Date.parse(YTD_SERIES[0][0]);
  const t1 = Date.parse(YTD_SERIES[YTD_SERIES.length - 1][0]);
  const x = (d: string) => left + ((Date.parse(d) - t0) / (t1 - t0)) * (W - left - right);
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo));
  const line = (i: 1 | 2) => YTD_SERIES.map((r, k) => `${k ? "L" : "M"}${x(r[0]).toFixed(1)} ${y(r[i]).toFixed(1)}`).join(" ");
  const last = YTD_SERIES[YTD_SERIES.length - 1];
  const ticks = Array.from({ length: (hi - lo) / 20 + 1 }, (_, i) => lo + i * 20);
  const months = ["2026-01-01", "2026-03-01", "2026-05-01", "2026-07-01", "2026-09-01"];
  const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  return (
    <figure className="dark-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Return since January 1, 2026: portfolio ${pct(last[1])}, S&P 500 ${pct(last[2])}`}>
        <rect width={W} height={H} className="dc-bg" />
        <g transform={`translate(${left} 26)`} className="dc-legend">
          <rect width="14" height="3" y="-6" className="dc-bar" />
          <text x="22">Portfolio</text>
          <rect x="120" width="14" height="3" y="-6" className="dc-bar-muted" />
          <text x="142">S&amp;P 500</text>
        </g>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className={v === 0 ? "dc-base" : "dc-grid"} />
            <text x={left - 10} y={y(v) + 4} textAnchor="end" className="dc-axis">
              {v}%
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m} x={x(m)} y={H - 12} textAnchor="middle" className="dc-axis">
            {new Date(`${m}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
          </text>
        ))}
        <path d={line(2)} fill="none" className="dc-line-muted" strokeWidth="2" />
        <path d={line(1)} fill="none" className="dc-line" strokeWidth="2.5" strokeLinejoin="round" />
        <text x={x(last[0]) + 8} y={y(last[1]) + 5} className="dc-value dc-value-main">
          {pct(last[1])}
        </text>
        <text x={x(last[0]) + 8} y={y(last[2]) + 5} className="dc-axis">
          {pct(last[2])}
        </text>
      </svg>
      <p className="dc-source">{source}</p>
    </figure>
  );
}
