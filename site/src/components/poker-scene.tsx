"use client";

import { useEffect, useRef } from "react";
import { buildFormation, formationCount, PARTS, rng, type Formation, type Variant } from "./poker-formations";

/**
 * The "play winnable games" thread (Kevin 2026-11-09): thousands of points blow in like wind from the left, gather into
 * a poker scene that turns 360° on a rock and roll beat (the turn moves in chunks on each beat, heads nod, chips
 * flash), then fly away to the right, and the loop starts again. One variant per page (`poker-formations.ts`).
 *
 * Cost rules: a canvas drawn in the browser only (the Worker renders an empty canvas, zero CPU), started after the page
 * has loaded and the browser is idle, paused when off screen or in a background tab. Reduced motion = one still frame.
 */

const BPM = 138;
const BEAT = 60 / BPM;
const IN = 2.6;
const OUT = 2.4;
const TILT = 0.46;
const DEPTH = 7;
const BUCKETS = 6;
const HEAD = PARTS.indexOf("head");
const CHIP = PARTS.indexOf("chip");

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Overshoot then settle: each beat kicks the turn a little past its step. */
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

type Fit = { radius: number; top: number; bottom: number };

function fitOf(f: Formation): Fit {
  let radius = 0;
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 0; i < f.x.length; i++) {
    radius = Math.max(radius, Math.hypot(f.x[i], f.z[i]));
    top = Math.max(top, f.y[i]);
    bottom = Math.min(bottom, f.y[i]);
  }
  return { radius, top, bottom };
}

export function PokerScene({ variant, className, label }: { variant: Variant; className?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let idle = 0;
    let disposed = false;
    let visible = false;
    let last = 0;
    let clock = 0;
    let started = false;
    const cleanups: (() => void)[] = [];

    const start = () => {
      if (disposed) return;
      const small = Math.min(window.innerWidth, window.innerHeight) < 700;
      const n = small ? 1400 : 2800;
      const count = formationCount(variant);
      const forms = Array.from({ length: count }, (_, k) => buildFormation(variant, k, n));
      const fits = forms.map(fitOf);
      const hold = count > 1 ? 9.6 : 7.4;
      const loop = IN + hold + OUT;
      const r = rng(11);
      // Per point: when it arrives, where it comes from (left) and leaves to (right), its gust phase.
      const delay = new Float32Array(n);
      const sx = new Float32Array(n);
      const sy = new Float32Array(n);
      const sz = new Float32Array(n);
      const ex = new Float32Array(n);
      const ey = new Float32Array(n);
      const gust = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        delay[i] = r() * 1.1;
        sx[i] = -4.2 - r() * 2.5;
        sy[i] = (r() - 0.5) * 3.2;
        sz[i] = (r() - 0.5) * 3;
        ex[i] = 4.2 + r() * 2.5;
        ey[i] = (r() - 0.5) * 3.2;
        gust[i] = r() * Math.PI * 2;
      }
      // Camera-space positions of the current shape.
      const cx = new Float32Array(n);
      const cy = new Float32Array(n);
      const cz = new Float32Array(n);
      const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
      let width = 0;
      let height = 0;
      let dpr = 1;

      const resize = () => {
        const box = canvas.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = box.width;
        height = box.height;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      };
      resize();
      const ro = new ResizeObserver(() => {
        resize();
        if (reduce) draw(IN + hold * 0.4);
      });
      ro.observe(canvas);
      cleanups.push(() => ro.disconnect());

      /** Rotate formation f by theta (each point around its own table) and tilt the camera, into cx/cy/cz. */
      const place = (f: Formation, theta: number, nod: number, mix: number) => {
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const ct = Math.cos(TILT);
        const st = Math.sin(TILT);
        for (let i = 0; i < n; i++) {
          const lx = f.x[i] - f.px[i];
          const lz = f.z[i] - f.pz[i];
          const x = f.px[i] + lx * c - lz * s;
          const z = f.pz[i] + lx * s + lz * c;
          const y = f.y[i] - (f.part[i] === HEAD ? nod : 0);
          const yy = y * ct - z * st;
          const zz = y * st + z * ct;
          cx[i] = cx[i] * (1 - mix) + x * mix;
          cy[i] = cy[i] * (1 - mix) + yy * mix;
          cz[i] = cz[i] * (1 - mix) + zz * mix;
        }
      };

      const draw = (t: number) => {
        const holdT = clamp01((t - IN) / hold);
        // The turn: one 360° per loop, in chunks on each beat (rock and roll), drifting a little in and out.
        const beats = Math.max(1, Math.round(hold / BEAT));
        const beatPos = clamp01((t - IN) / (beats * BEAT)) * beats;
        const beatIdx = Math.floor(beatPos);
        const frac = beatPos - beatIdx;
        const inHold = t >= IN && t < IN + hold;
        const turn = inHold ? (beatIdx + easeOutBack(frac)) / beats : t < IN ? 0 : 1;
        const drift = (t - IN) * 0.05;
        const theta = turn * Math.PI * 2 + drift + 0.35;
        const kick = inHold ? Math.exp(-frac * 7) * (beatIdx % 2 === 0 ? 1 : 0.55) : 0;
        const nod = kick * 0.07;

        // Formation morph (Company: three tables, then the one we pick).
        let morph = 0;
        if (forms.length > 1) morph = easeInOut(clamp01((holdT - 0.42) / 0.16));
        place(forms[0], theta, nod, 1);
        if (morph > 0) place(forms[1], theta, nod, morph);
        const fa = fits[0];
        const fb = fits[forms.length - 1];
        const radius = fa.radius + (fb.radius - fa.radius) * morph;
        const top = fa.top + (fb.top - fa.top) * morph;
        const bottom = fa.bottom + (fb.bottom - fa.bottom) * morph;

        // Fit the shape in the canvas, with room for the wind.
        const spanY = (top - bottom) * Math.cos(TILT) + 2 * radius * Math.sin(TILT);
        const scale = Math.min(width / (2 * radius * 1.12), height / (spanY * 1.22)) * (1 + kick * 0.025);
        const ox = width / 2;
        const midY = ((top + bottom) / 2) * Math.cos(TILT);
        const oy = height / 2 + midY * scale;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        for (const b of buckets) b.length = 0;
        const outStart = IN + hold;
        const sxs = new Float32Array(2);
        for (let i = 0; i < n; i++) {
          let x = cx[i];
          let y = cy[i];
          let z = cz[i];
          if (t < IN) {
            const e = easeOutCubic(clamp01((t - delay[i]) / (IN - 1.1)));
            const w = (1 - e) * 0.5 * Math.sin(gust[i] + t * 3 + sx[i]);
            x = sx[i] + (x - sx[i]) * e;
            y = sy[i] + (y - sy[i]) * e + w;
            z = sz[i] + (z - sz[i]) * e;
          } else if (t >= outStart) {
            const e = easeInCubic(clamp01((t - outStart - delay[i] * 0.8) / (OUT - 0.9)));
            const w = e * 0.5 * Math.sin(gust[i] + t * 3);
            x = x + (ex[i] - x) * e;
            y = y + (ey[i] - y) * e + w;
          }
          const p = DEPTH / (DEPTH + z);
          sxs[0] = ox + x * scale * p;
          sxs[1] = oy - y * scale * p;
          if (sxs[0] < -4 || sxs[0] > width + 4 || sxs[1] < -4 || sxs[1] > height + 4) continue;
          // Nearer points are brighter; chips flash on the beat.
          let lvl = Math.floor(clamp01((1.9 - z) / 3.8) * (BUCKETS - 1));
          if (forms[0].part[i] === CHIP && kick > 0.4) lvl = BUCKETS - 1;
          buckets[lvl].push(sxs[0], sxs[1], p);
        }
        for (let b = 0; b < BUCKETS; b++) {
          const list = buckets[b];
          ctx.fillStyle = `rgba(255,255,255,${0.22 + (b / (BUCKETS - 1)) * 0.73})`;
          const size = 1.2 + b * 0.24;
          for (let k = 0; k < list.length; k += 3) {
            const s = size * list[k + 2];
            ctx.fillRect(list[k] - s / 2, list[k + 1] - s / 2, s, s);
          }
        }
      };

      if (reduce) {
        draw(IN + hold * 0.4);
        return;
      }

      const frame = (now: number) => {
        raf = 0;
        if (!visible || document.hidden || disposed) return;
        const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        clock = (clock + dt) % loop;
        draw(clock);
        raf = requestAnimationFrame(frame);
      };
      const resume = () => {
        if (!raf && visible && !document.hidden) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      };
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        resume();
      });
      io.observe(canvas);
      document.addEventListener("visibilitychange", resume);
      cleanups.push(() => io.disconnect(), () => document.removeEventListener("visibilitychange", resume));
      started = true;
    };

    // Start once the page has loaded and the main thread is free: the scene never competes with the page itself.
    const schedule = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idle = ric ? ric(start, { timeout: 1500 }) : window.setTimeout(start, 200);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", schedule);
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (cic) cic(idle);
      else window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      if (started || cleanups.length) cleanups.forEach((c) => c());
    };
  }, [variant]);

  return <canvas ref={ref} className={`poker-scene${className ? ` ${className}` : ""}`} role="img" aria-label={label} />;
}
