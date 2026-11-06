import { BRAND, categoryLabel, constellation, formatDate, type ResearchCategory } from "@/lib/model";

/**
 * A report cover built from the post itself, never an AI image (Thierry 2026-11-04): navy page, the post's own
 * constellation (seeded by its id), shelf, title, date, the mark. Every cover looks like the same series.
 */
export function Cover({ id, title, category, publishedAt, className = "cover" }: { id: string; title: string; category: ResearchCategory | null; publishedAt: string | null; className?: string }) {
  const W = 300;
  const H = 400;
  const { nodes, edges } = constellation(id, W, 220, 4, 6);
  const words = title.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 22) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  const shown = lines.slice(0, 5);
  if (lines.length > 5) shown[4] = shown[4].replace(/\s*\S*$/, "") + "...";
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cover: ${title}`}>
      <rect width={W} height={H} className="cv-bg" />
      <g transform="translate(0 150)" className="cv-net">
        {edges.map((e, i) => (
          <line key={i} x1={nodes[e.a].x} y1={nodes[e.a].y} x2={nodes[e.b].x} y2={nodes[e.b].y} className={e.cross ? "cross" : ""} />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} className={i % 6 === 0 ? "hub" : ""} />
        ))}
      </g>
      <text x="22" y="34" className="cv-shelf">
        {categoryLabel(category).toUpperCase()}
      </text>
      <text x="22" y="56" className="cv-date">
        {formatDate(publishedAt) ?? ""}
      </text>
      {shown.map((l, i) => (
        <text key={i} x="22" y={92 + i * 24} className="cv-title">
          {l}
        </text>
      ))}
      <g transform="translate(22 366)">
        <g transform="scale(0.0547)">
          <path d="M60 44 H128 A84 84 0 0 1 128 212 H60 Z" className="cv-mark-o" />
          <path d="M60 212 L108 164 L123.42 179.42 L187.4 68.6 A84 84 0 0 1 128 212 Z" className="cv-mark-f" />
        </g>
        <text x="22" y="11" className="cv-brand">
          {BRAND.toUpperCase()}
        </text>
      </g>
    </svg>
  );
}
