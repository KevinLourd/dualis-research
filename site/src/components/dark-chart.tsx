import { SealWatermark } from "./mark";

/**
 * Thierry's Note chart style (docs/screenshots/thierry-note-cpng-2026-11-03.png): near-black ground, faint gridlines,
 * legend on top, a value on every bar, an "E" suffix on estimate periods. Bars are the Dualis purple.
 */
export type ChartBar = { label: string; value: number; estimate?: boolean; muted?: boolean };

export function DarkChart({
  title,
  legend,
  bars,
  format = (v) => String(v),
  source,
  max,
}: {
  title?: string;
  legend: string;
  bars: ChartBar[];
  format?: (v: number) => string;
  source: string;
  max?: number;
}) {
  const W = 640;
  const H = 340;
  const left = 56;
  const right = 20;
  const top = 64;
  const bottom = 40;
  const top0 = max ?? niceMax(Math.max(...bars.map((b) => b.value)));
  const ticks = 4;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / top0);
  const slot = (W - left - right) / bars.length;
  const bw = Math.min(88, slot * 0.6);
  return (
    <figure className="dark-chart">
      {title && <figcaption className="dc-title">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${legend}: ${bars.map((b) => `${b.label} ${format(b.value)}`).join(", ")}`}>
        <rect width={W} height={H} className="dc-bg" />
        <SealWatermark w={W} h={H} />
        <g transform={`translate(${left} 26)`}>
          <rect width="12" height="12" y="-10" rx="2" className="dc-bar" />
          <text x="20" className="dc-legend">
            {legend}
          </text>
        </g>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (top0 / ticks) * i;
          return (
            <g key={i}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className={i === 0 ? "dc-base" : "dc-grid"} />
              <text x={left - 10} y={y(v) + 4} textAnchor="end" className="dc-axis">
                {format(v)}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const cx = left + slot * (i + 0.5);
          return (
            <g key={b.label}>
              <rect x={cx - bw / 2} y={y(b.value)} width={bw} height={y(0) - y(b.value)} rx="4" className={`${b.muted ? "dc-bar-muted" : "dc-bar"} grow`} style={{ ["--d" as string]: `${0.2 + i * 0.2}s` }} />
              <text x={cx} y={y(b.value) - 10} textAnchor="middle" className="dc-value late" style={{ ["--d" as string]: `${0.9 + i * 0.2}s` }}>
                {format(b.value)}
              </text>
              <text x={cx} y={H - 14} textAnchor="middle" className="dc-axis">
                {b.label}
                {b.estimate ? "E" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="dc-source">{source}</p>
    </figure>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v * 1.12) return m * p;
  return 10 * p;
}
