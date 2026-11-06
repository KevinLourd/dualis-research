/**
 * Multi-source provenance, pure functions (no database), shared by every attribute dimension.
 *
 * Rule: a value several sources agree on is ONE fact carrying EVERY source tag, never first-found.
 * A source's latest answer replaces its previous one; a value nobody asserts any more disappears from silver
 * (bronze still holds every past answer).
 */

/** One "field = value" claim a source made, read from one bronze row. */
export type Assertion = { source: string; field: string; value: unknown; bronzeId: string };

/** The silver shape of a fact. `sources[i]` was read from `bronzeIds[i]`. */
export type FactState = {
  field: string;
  value: unknown;
  valueKey: string;
  sources: string[];
  bronzeIds: string[];
};

/** Comparison key: case, spacing and punctuation do not make two answers different. */
export function valueKey(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
  return stableJson(value);
}

/** JSON with object keys sorted: Postgres jsonb reorders keys, so the same object read back must compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A value worth asserting: not null, not blank. A source with nothing to say keeps its previous answer. */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/** New fact state for ONE subject after applying a batch of assertions (later assertions win per source+field). */
export function applyAssertions(existing: FactState[], assertions: Assertion[]): FactState[] {
  const facts = existing.map((f) => ({ ...f, sources: [...f.sources], bronzeIds: [...f.bronzeIds] }));
  for (const a of assertions) {
    if (!isPresent(a.value)) continue;
    // The source's previous answer on this field is replaced.
    for (const f of facts) {
      if (f.field !== a.field) continue;
      const i = f.sources.indexOf(a.source);
      if (i !== -1) {
        f.sources.splice(i, 1);
        f.bronzeIds.splice(i, 1);
      }
    }
    const key = valueKey(a.value);
    const match = facts.find((f) => f.field === a.field && f.valueKey === key);
    if (match) {
      match.sources.push(a.source);
      match.bronzeIds.push(a.bronzeId);
    } else {
      facts.push({ field: a.field, value: a.value, valueKey: key, sources: [a.source], bronzeIds: [a.bronzeId] });
    }
  }
  return facts.filter((f) => f.sources.length > 0);
}

/**
 * Picks the value gold shows for one field, deterministically:
 * 1. a value carrying a MANUAL source (Thierry's own word) wins;
 * 2. then the value most sources agree on;
 * 3. then the value of the highest-priority source;
 * 4. then the smallest value key (total order, no randomness).
 */
export function pickWinner(
  candidates: FactState[],
  opts: { priority: readonly string[]; manual: readonly string[] },
): FactState | null {
  if (candidates.length === 0) return null;
  const rank = (s: string) => {
    const i = opts.priority.indexOf(s);
    return i === -1 ? opts.priority.length : i;
  };
  const best = (f: FactState) => Math.min(...f.sources.map(rank));
  const manual = (f: FactState) => f.sources.some((s) => opts.manual.includes(s));
  return [...candidates].sort(
    (a, b) =>
      Number(manual(b)) - Number(manual(a)) ||
      b.sources.length - a.sources.length ||
      best(a) - best(b) ||
      a.valueKey.localeCompare(b.valueKey),
  )[0];
}
