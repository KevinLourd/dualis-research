"use client";

import { useEffect, useRef } from "react";
import { constellation } from "@/lib/model";

/**
 * The home hero's live background: industries as clusters of dots linked along the value chain, drifting slowly.
 * The pointer is a spotlight: it lights the dots and links under it in purple and leaves the graph exactly where it
 * is (Kevin 2026-11-05: « ça met en lumière les graphes, mais ne modifie pas la structure »): no push, no lean, no
 * extra line. Without a pointer (phones) a slow virtual spotlight wanders. Reduced motion: one still frame.
 */
/** `plain`: the graph drawn once, still: no spotlight, no pointer, no motion (the home hero, Kevin 2026-11-05). */
export function HeroField({ seed = "dualis-hero", clusters: wide = 7, perCluster = 9, className = "hero-field", plain = false }: { seed?: string; clusters?: number; perCluster?: number; className?: string; plain?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = plain || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const PURPLE = [139, 108, 255] as const;
    const R = 190;

    let w = 0;
    let h = 0;
    let dpr = 1;
    type P = { bx: number; by: number; x: number; y: number; r: number; hub: boolean; phase: number; depth: number };
    let pts: P[] = [];
    let edges: { a: number; b: number; cross: boolean }[] = [];
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false, lastMove: 0 };

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const clusters = w < 700 ? Math.min(4, wide) : wide;
      const g = constellation(seed, w, h, clusters, perCluster);
      pts = g.nodes.map((n, i) => ({ bx: n.x, by: n.y, x: n.x, y: n.y, r: n.r * 1.1, hub: i % perCluster === 0, phase: i * 1.7, depth: 0.4 + ((i * 37) % 60) / 100 }));
      edges = g.edges;
      // Ambient dust: far, faint, unlinked.
      const extra = Math.round((w * h) / 9000);
      for (let i = 0; i < extra; i++) {
        const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const y = (Math.sin(i * 78.233) * 12543.123) % 1;
        pts.push({ bx: Math.abs(x) * w, by: Math.abs(y) * h, x: 0, y: 0, r: 0.8, hub: false, phase: i, depth: 0.15 });
      }
    };

    const frame = (t: number) => {
      // Ease the cursor; wander when idle.
      if (plain) {
        mouse.tx = mouse.x = -1e6;
        mouse.ty = mouse.y = -1e6;
      } else if (!mouse.active || t - mouse.lastMove > 4000) {
        mouse.tx = w * (0.55 + 0.3 * Math.sin(t / 5200));
        mouse.ty = h * (0.45 + 0.25 * Math.sin(t / 3700));
      }
      if (mouse.x < -1000) {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
      }
      mouse.x += (mouse.tx - mouse.x) * 0.18;
      mouse.y += (mouse.ty - mouse.y) * 0.18;

      ctx.clearRect(0, 0, w, h);
      if (!plain) {
        // The spotlight: a wide purple wash, then a bright core.
        const wash = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, R * 2.6);
        wash.addColorStop(0, "rgba(139,108,255,0.38)");
        wash.addColorStop(0.45, "rgba(139,108,255,0.14)");
        wash.addColorStop(1, "rgba(139,108,255,0)");
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, w, h);
        const core = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, R * 0.9);
        core.addColorStop(0, "rgba(214,204,255,0.30)");
        core.addColorStop(1, "rgba(214,204,255,0)");
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, w, h);
      }

      for (const p of pts) {
        const dx0 = Math.sin(t / 2600 + p.phase) * 6 * p.depth;
        const dy0 = Math.cos(t / 3100 + p.phase) * 6 * p.depth;
        p.x = p.bx + dx0;
        p.y = p.by + dy0;
      }

      for (const e of edges) {
        const a = pts[e.a];
        const b = pts[e.b];
        const mid = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y);
        const heat = Math.max(0, 1 - mid / (R * 1.8)) ** 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.setLineDash(e.cross ? [3, 5] : []);
        ctx.lineWidth = 1 + heat * 1.6;
        ctx.strokeStyle = heat > 0 ? `rgba(${heat > 0.5 ? "201,188,255" : PURPLE.join(",")},${0.3 + heat * 0.7})` : e.cross ? "rgba(139,108,255,0.28)" : "rgba(255,255,255,0.1)";
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const p of pts) {
        const d = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const heat = Math.max(0, 1 - d / (R * 1.4));
        const pulse = p.hub && !plain ? 1 + 0.35 * Math.sin(t / 700 + p.phase) : 1;
        if (heat > 0.15) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${PURPLE.join(",")},${heat * 0.3})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse * (1 + heat * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = p.hub ? `rgba(${PURPLE.join(",")},1)` : heat > 0 ? `rgba(226,219,255,${Math.min(1, 0.2 + p.depth * 0.5 + heat * 0.8)})` : `rgba(255,255,255,${0.15 + p.depth * 0.5})`;
        ctx.fill();
        if (p.hub) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 4 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(139,108,255,0.12)";
          ctx.fill();
        }
      }
    };

    build();
    let raf = 0;
    let visible = true;
    const loop = (t: number) => {
      frame(t);
      raf = visible ? requestAnimationFrame(loop) : 0;
    };
    if (still) frame(0);
    else raf = requestAnimationFrame(loop);
    // Stop drawing while off screen; resume when it scrolls back in.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !still) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < -40 || y < -40 || x > r.width + 40 || y > r.height + 40) return;
      mouse.tx = x;
      mouse.ty = y;
      mouse.active = true;
      mouse.lastMove = performance.now();
    };
    const onResize = () => {
      build();
      if (still) frame(0);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, [seed, wide, perCluster, plain]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
