/**
 * Multi-source merge for ENTITY rows (a filing, an insider trade): rows with the same natural key are one entity
 * carrying every source that reported it, never first-found. Pure; the dimension writes the result.
 */
export type Sourced<T> = T & { sources: string[]; bronzeIds: string[] };

/**
 * Folds new sightings into existing rows by key. A source seen again replaces its own bronze id; fields keep the
 * value of the highest-priority source that has one (`priority`, earlier = more trusted).
 */
export function mergeSightings<T extends Record<string, unknown>>(
  existing: Map<string, Sourced<T>>,
  sightings: { key: string; source: string; bronzeId: string; row: T }[],
  priority: readonly string[],
): Map<string, Sourced<T>> {
  const rank = (s: string) => {
    const i = priority.indexOf(s);
    return i === -1 ? priority.length : i;
  };
  const out = new Map([...existing].map(([k, v]) => [k, { ...v, sources: [...v.sources], bronzeIds: [...v.bronzeIds] }]));
  for (const s of sightings) {
    const current = out.get(s.key);
    if (!current) {
      out.set(s.key, { ...s.row, sources: [s.source], bronzeIds: [s.bronzeId] });
      continue;
    }
    const i = current.sources.indexOf(s.source);
    if (i !== -1) {
      current.sources.splice(i, 1);
      current.bronzeIds.splice(i, 1);
    }
    const outranks = current.sources.every((c) => rank(s.source) < rank(c));
    for (const [field, value] of Object.entries(s.row)) {
      if (value === null || value === undefined) continue;
      if (outranks || current[field] === null || current[field] === undefined) (current as Record<string, unknown>)[field] = value;
    }
    const pairs = [...current.sources.map((src, j) => [src, current.bronzeIds[j]]), [s.source, s.bronzeId]];
    pairs.sort((a, b) => rank(a[0]) - rank(b[0]));
    current.sources = pairs.map((p) => p[0]);
    current.bronzeIds = pairs.map((p) => p[1]);
  }
  return out;
}
