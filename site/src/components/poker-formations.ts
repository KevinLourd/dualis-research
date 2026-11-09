/**
 * The "play winnable games" thread (Thierry 2026-11-06, Kevin 2026-11-09): every page shows one poker scene made of
 * thousands of points. This file only builds the 3D point clouds (pure math, no DOM): a formation is N target points
 * in world units (y up, the scene fits a radius of about 2), each tagged with its part so the renderer can make the
 * heads nod on the beat. `poker-scene.tsx` blows the points in like wind, holds the shape while it turns 360°, then
 * scatters it.
 */

export type Part = "table" | "player" | "head" | "card" | "chip";
export const PARTS: readonly Part[] = ["table", "player", "head", "card", "chip"];

/** One formation: flat arrays of length n. `px` / `pz` = the pivot each point turns around (its own table). */
export type Formation = { x: Float32Array; y: Float32Array; z: Float32Array; px: Float32Array; pz: Float32Array; part: Uint8Array };

/** The page variants: each page tells its own beat of the story. */
export type Variant = "home" | "company" | "research" | "portfolio" | "about" | "contact" | "plans";

type Pt = [number, number, number];
type Sampler = (r: () => number) => Pt;
type Piece = { part: Part; weight: number; sample: Sampler; pivot?: [number, number] };

/** Deterministic random numbers, so the server-free still frame and every replay draw the same scene. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Rotate a point placed on the +x axis to the seat angle `a` around (cx, cz). */
function seat(p: Pt, a: number, cx = 0, cz = 0, s = 1): Pt {
  const c = Math.cos(a);
  const n = Math.sin(a);
  return [cx + (p[0] * c - p[2] * n) * s, p[1] * s, cz + (p[0] * n + p[2] * c) * s];
}

function onSphere(r: () => number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): Pt {
  const u = r() * 2 - 1;
  const t = r() * TAU;
  const k = Math.sqrt(1 - u * u);
  return [cx + rx * k * Math.cos(t), cy + ry * u, cz + rz * k * Math.sin(t)];
}

function onSegment(r: () => number, a: Pt, b: Pt, jitter: number): Pt {
  const t = r();
  return [a[0] + (b[0] - a[0]) * t + (r() - 0.5) * jitter, a[1] + (b[1] - a[1]) * t + (r() - 0.5) * jitter, a[2] + (b[2] - a[2]) * t + (r() - 0.5) * jitter];
}

/** A round table: a dense rim, a sparse felt, a pedestal. */
function table(cx = 0, cz = 0, s = 1): Piece[] {
  const pivot: [number, number] = [cx, cz];
  return [
    { part: "table", weight: 0.1 * s, pivot, sample: (r) => { const a = r() * TAU; const d = 1 + (r() - 0.5) * 0.05; return [cx + Math.cos(a) * d * s, (r() - 0.5) * 0.04 * s, cz + Math.sin(a) * d * s]; } },
    { part: "table", weight: 0.06 * s, pivot, sample: (r) => { const a = r() * TAU; const d = Math.sqrt(r()) * 0.94; return [cx + Math.cos(a) * d * s, 0, cz + Math.sin(a) * d * s]; } },
    { part: "table", weight: 0.03 * s, pivot, sample: (r) => { const a = r() * TAU; return [cx + Math.cos(a) * 0.12 * s, -r() * 0.75 * s, cz + Math.sin(a) * 0.12 * s]; } },
    { part: "table", weight: 0.03 * s, pivot, sample: (r) => { const a = r() * TAU; const d = 0.2 + r() * 0.25; return [cx + Math.cos(a) * d * s, -0.75 * s, cz + Math.sin(a) * d * s]; } },
  ];
}

/** A seated player, faceless: head, shoulders and torso as shells, arms reaching to the table edge, two cards. */
function player(a: number, cx = 0, cz = 0, s = 1, chips = 0.18): Piece[] {
  const pivot: [number, number] = [cx, cz];
  const at = (p: Pt) => seat(p, a, cx, cz, s);
  return [
    { part: "head", weight: 0.05 * s, pivot, sample: (r) => at(onSphere(r, 1.42, 0.98, 0, 0.13, 0.16, 0.13)) },
    { part: "player", weight: 0.11 * s, pivot, sample: (r) => { const p = onSphere(r, 1.45, 0.42, 0, 0.16, 0.4, 0.3);
      // Taper the torso to the waist: shoulders wide, hips narrow.
      const k = 0.62 + 0.38 * Math.min(1, Math.max(0, (p[1] - 0.05) / 0.6));
      return at([1.45 + (p[0] - 1.45) * k, Math.max(p[1], 0.05), p[2] * k]); } },
    { part: "player", weight: 0.03 * s, pivot, sample: (r) => at(onSegment(r, [1.42, 0.72, -0.3], [1.42, 0.72, 0.3], 0.05)) },
    { part: "player", weight: 0.008 * s, pivot, sample: (r) => at(onSegment(r, [1.43, 0.76, 0], [1.42, 0.86, 0], 0.06)) },
    { part: "player", weight: 0.02 * s, pivot, sample: (r) => at(onSegment(r, [1.4, 0.68, -0.28], [0.92, 0.05, -0.16], 0.05)) },
    { part: "player", weight: 0.02 * s, pivot, sample: (r) => at(onSegment(r, [1.4, 0.68, 0.28], [0.92, 0.05, 0.16], 0.05)) },
    { part: "card", weight: 0.012 * s, pivot, sample: (r) => at([0.7 + r() * 0.14, 0.01, -0.1 + r() * 0.09]) },
    { part: "card", weight: 0.012 * s, pivot, sample: (r) => at([0.7 + r() * 0.14, 0.01, 0.01 + r() * 0.09]) },
    ...(chips > 0 ? [chipStack(seat([0.62, 0, 0.26], a, cx, cz, s), chips * s, 0.06 * s, 0.01 * s, pivot)] : []),
  ];
}

/** A stack of chips: rings at each chip edge, so it reads as a cylinder. */
function chipStack(at: Pt, height: number, radius: number, weightScale: number, pivot: [number, number]): Piece {
  return {
    part: "chip",
    weight: weightScale + height * 0.06,
    pivot,
    sample: (r) => {
      const a = r() * TAU;
      return [at[0] + Math.cos(a) * radius, at[1] + r() * height, at[2] + Math.sin(a) * radius];
    },
  };
}

/** Five community cards in the middle of the felt. */
function board(cx = 0, cz = 0, s = 1, count = 5): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    part: "card" as Part,
    weight: 0.01 * s,
    pivot: [cx, cz] as [number, number],
    sample: (r: () => number): Pt => [cx + (-0.36 + i * 0.18 + r() * 0.13) * s, 0.01, cz + (-0.09 + r() * 0.18) * s],
  }));
}

/** An empty chair facing the table: a seat and a back, the place kept for the reader. */
function emptyChair(a: number): Piece[] {
  const at = (p: Pt) => seat(p, a);
  return [
    { part: "card", weight: 0.03, sample: (r) => at([1.3 + r() * 0.36, 0.1 + (r() - 0.5) * 0.03, -0.22 + r() * 0.44]) },
    { part: "card", weight: 0.03, sample: (r) => at([1.66 + (r() - 0.5) * 0.03, 0.1 + r() * 0.6, -0.22 + r() * 0.44]) },
    { part: "card", weight: 0.01, sample: (r) => { const c = r() < 0.5 ? -0.2 : 0.2; return at([1.48, -r() * 0.7, c]); } },
  ];
}

/** A playing card standing up, fanned: an outline, a diamond pip in the middle, a small pip in the corner. */
function standingCard(angle: number, x0: number): Piece[] {
  const w = 0.62;
  const h = 0.9;
  // The card turns around its bottom centre (the fan's hinge sits below the hand).
  const place = (u: number, v: number, depth: number): Pt => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const lx = u - w / 2;
    const ly = v + 0.55;
    return [x0 + lx * c - ly * s, -0.8 + lx * s + ly * c, depth];
  };
  const depth = x0 * 0.02;
  return [
    {
      part: "card",
      weight: 0.06,
      sample: (r) => {
        const t = r() * 2 * (w + h);
        const [u, v] = t < w ? [t, 0] : t < w + h ? [w, t - w] : t < 2 * w + h ? [2 * w + h - t, h] : [0, 2 * (w + h) - t];
        return place(u, v, depth);
      },
    },
    {
      part: "chip",
      weight: 0.035,
      sample: (r) => {
        const t = r() * TAU;
        const k = 0.15;
        const u = w / 2 + Math.cos(t) * k * Math.abs(Math.cos(t));
        const v = h / 2 + Math.sin(t) * k * 1.4 * Math.abs(Math.sin(t));
        return place(u, v, depth);
      },
    },
    { part: "card", weight: 0.008, sample: (r) => place(0.08 + r() * 0.06, h - 0.1 - r() * 0.1, depth) },
  ];
}

/** Rising chip stacks on the felt: a growth chart built from winnings. */
function stacksChart(): Piece[] {
  const heights = [0.18, 0.3, 0.26, 0.48, 0.62, 0.9];
  return [
    ...table(),
    ...heights.map((h, i) => chipStack([-0.62 + i * 0.25, 0, (i % 2) * 0.12 - 0.06], h, 0.09, 0.02, [0, 0])),
  ];
}

/** One player per seat, `n` seats. */
const ring = (n: number, f: (i: number) => Piece[]): Piece[] => Array.from({ length: n }, (_, i) => f(i)).flat();

const FORMATIONS: Record<Variant, Piece[][]> = {
  // A full table: six players, the board on the felt.
  home: [[...table(), ...board(), ...ring(6, (i) => player((i / 6) * TAU + 0.3, 0, 0, 1, 0.12 + (i % 3) * 0.08))]],
  // Pick the table: three tables in the room, then the one we sit at.
  company: [
    [
      ...[-2.3, 0, 2.3].flatMap((cx, t) => [
        ...table(cx, 0, 0.62),
        ...ring([6, 5, 3][t], (i) => player((i / [6, 5, 3][t]) * TAU + 0.4, cx, 0, 0.62, 0.1)),
      ]),
    ],
    [...table(), ...board(), ...ring(3, (i) => player((i / 3) * TAU + 0.5, 0, 0, 1, 0.14))],
  ],
  // The hand behind the call: five cards fanned.
  research: [[...[-0.5, -0.25, 0, 0.25, 0.5].flatMap((ang, i) => standingCard(-ang, (i - 2) * 0.42))]],
  // Winnings stacked into a rising chart.
  portfolio: [stacksChart()],
  // The analyst at his seat, close up.
  about: [[...table(), ...board(), ...player(Math.PI * 0.5, 0, 0, 1, 0.3)]],
  // Heads-up: two players across the table, a conversation.
  contact: [[...table(), ...player(0, 0, 0, 1, 0.2), ...player(Math.PI, 0, 0, 1, 0.2)]],
  // Five players and one chair kept for the reader.
  plans: [[...table(), ...board(), ...ring(5, (i) => player(((i + 1) / 6) * TAU, 0, 0, 1, 0.16)), ...emptyChair(0)]],
};

/** The number of formations a variant walks through in one loop. */
export function formationCount(variant: Variant): number {
  return FORMATIONS[variant].length;
}

/** Build formation `index` of `variant` with exactly `n` points (same count for every formation, so points morph). */
export function buildFormation(variant: Variant, index: number, n: number, seed = 7): Formation {
  const pieces = FORMATIONS[variant][index];
  const r = rng(seed + index * 101);
  const total = pieces.reduce((sum, p) => sum + p.weight, 0);
  const f: Formation = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), px: new Float32Array(n), pz: new Float32Array(n), part: new Uint8Array(n) };
  let i = 0;
  pieces.forEach((piece, k) => {
    const end = k === pieces.length - 1 ? n : Math.min(n, i + Math.round((piece.weight / total) * n));
    for (; i < end; i++) {
      const [x, y, z] = piece.sample(r);
      f.x[i] = x;
      f.y[i] = y;
      f.z[i] = z;
      f.px[i] = piece.pivot?.[0] ?? 0;
      f.pz[i] = piece.pivot?.[1] ?? 0;
      f.part[i] = PARTS.indexOf(piece.part);
    }
  });
  // Shuffle the point order, so a morph sends each point to a random place of the next shape (no visible seams).
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    for (const arr of [f.x, f.y, f.z, f.px, f.pz, f.part] as (Float32Array | Uint8Array)[]) {
      const t = arr[k];
      arr[k] = arr[j];
      arr[j] = t;
    }
  }
  return f;
}
