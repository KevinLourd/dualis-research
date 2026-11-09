import { colorValue, type DesignTokens } from "./queries";

/**
 * The chart style drawn from design/tokens.json `chart` (the same rules the Claude chart skill follows): legend on
 * top, faint gridlines, rounded bars with a value on each, "E" on the estimate, a second series as a dotted line,
 * source line under. Example numbers, labelled as such.
 */
const BARS = [
  { label: "FY22", value: 412 },
  { label: "FY23", value: 455 },
  { label: "FY24", value: 498 },
  { label: "FY25", value: 541 },
  { label: "FY26E", value: 590 },
];
const MARGIN = [11.2, 12.4, 13.1, 14.6, 15.8];

export function ChartSample({ tokens, theme }: { tokens: DesignTokens; theme: "dark" | "light" }) {
  const spec = tokens.chart.themes[theme];
  const c = (name: string) => colorValue(tokens, name, "light");
  const [main, second] = spec.series.map(c);
  const W = 640;
  const H = 340;
  const left = 56;
  const right = 56;
  const top = 64;
  const bottom = 64;
  const max = 600;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const y2 = (v: number) => top + (H - top - bottom) * (1 - v / 20);
  const slot = (W - left - right) / BARS.length;
  const bw = slot * 0.56;
  const x = (i: number) => left + slot * (i + 0.5);
  const font = tokens.type.families.sans;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Example ${theme} chart in the Dualis style`} className="h-auto w-full max-w-[640px]" style={{ fontFamily: font }}>
      <rect width={W} height={H} fill={c(spec.background)} />
      <g fontSize="13" fill={c(spec.text)}>
        <rect x={left} y={18} width="12" height="12" rx="2" fill={main} />
        <text x={left + 20} y={29}>Revenue ($m)</text>
        <line x1={left + 130} x2={left + 152} y1={24} y2={24} stroke={second} strokeWidth="2" />
        <circle cx={left + 141} cy={24} r="3" fill={second} />
        <text x={left + 160} y={29}>EBITDA margin (%, right)</text>
      </g>
      {[0, 150, 300, 450, 600].map((v, i) => (
        <g key={v}>
          <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={c(i === 0 ? spec.baseline : spec.grid)} />
          <text x={left - 10} y={y(v) + 4} textAnchor="end" fontSize="11" fill={c(spec.axis)}>
            {v}
          </text>
          <text x={W - right + 10} y={y(v) + 4} fontSize="11" fill={c(spec.axis)}>
            {i * 5}%
          </text>
        </g>
      ))}
      {BARS.map((b, i) => {
        const h = y(0) - y(b.value);
        return (
          <g key={b.label}>
            <path d={`M${x(i) - bw / 2},${y(0)} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill={main} />
            <text x={x(i)} y={y(b.value) - 8} textAnchor="middle" fontSize="12" fill={c(spec.text)}>
              {b.value}
            </text>
            <text x={x(i)} y={y(0) + 18} textAnchor="middle" fontSize="11" fill={c(spec.axis)}>
              {b.label}
            </text>
          </g>
        );
      })}
      <polyline points={MARGIN.map((m, i) => `${x(i)},${y2(m)}`).join(" ")} fill="none" stroke={second} strokeWidth="2" />
      {MARGIN.map((m, i) => (
        <circle key={i} cx={x(i)} cy={y2(m)} r="3.5" fill={second} />
      ))}
      <text x={x(MARGIN.length - 1) + 8} y={y2(MARGIN.at(-1)!) - 8} fontSize="12" fill={second}>
        {MARGIN.at(-1)}%
      </text>
      <text x={left} y={H - 16} fontSize="11" fill={c(spec.axis)}>
        Source: example data, Dualis Research.
      </text>
    </svg>
  );
}
