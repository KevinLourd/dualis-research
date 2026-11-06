import { constellation } from "@/lib/model";

/**
 * Industries as clusters of dots, linked inside each industry and across the value chain (Thierry's process image,
 * 2026-11-04). Dots drift slowly; motion stops under reduced motion (CSS).
 */
export function Constellation({
  seed = "dualis",
  width = 720,
  height = 420,
  clusters = 5,
  perCluster = 7,
  labels,
  className = "constellation",
}: {
  seed?: string;
  width?: number;
  height?: number;
  clusters?: number;
  perCluster?: number;
  /** One label per industry, left to right (the value chain). */
  labels?: string[];
  className?: string;
}) {
  const { nodes, edges } = constellation(seed, width, height, clusters, perCluster);
  const hubs = nodes.filter((_, i) => i % perCluster === 0);
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Industries linked along a value chain">
      <g className="edges">
        {edges.map((e, i) => (
          <line key={i} x1={nodes[e.a].x} y1={nodes[e.a].y} x2={nodes[e.b].x} y2={nodes[e.b].y} className={e.cross ? "cross" : "inner"} pathLength={e.cross ? undefined : 1} style={{ ["--i" as string]: i }} />
        ))}
      </g>
      <g className="nodes">
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} className={i % perCluster === 0 ? "hub" : "dot"} style={{ animationDelay: `${(i % 9) * -0.7}s`, ["--i" as string]: i }} />
        ))}
      </g>
      {labels && (
        <g className="labels">
          {hubs.map((h, i) =>
            labels[i] ? (
              <text key={i} x={h.x} y={Math.min(height - 8, h.y + Math.min(width / clusters, height) * 0.42)} textAnchor="middle">
                {labels[i]}
              </text>
            ) : null,
          )}
        </g>
      )}
    </svg>
  );
}
