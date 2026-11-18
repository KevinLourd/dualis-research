import { Resvg } from "@resvg/resvg-js";

/**
 * Logo downloads of the Design system page (Kevin 2026-11-18: GitHub refused the SVG, « We only support PNG, GIF, or
 * JPG pictures », and the files were not cropped). Every file is made from the SVG source on GitHub main at request
 * time, so a logo edit changes its PNG with no copy to redraw:
 *  - `tightSvg` measures the drawn pixels (masks and clips included, which a geometric bbox misses) and sets the
 *    viewBox to them: the artwork touches every edge;
 *  - `logoPng` renders that tight SVG at `size` px on its long side, transparent where the source draws nothing.
 * A square avatar source (indigo ground, padded for a round crop) is already its own bounding box and stays as drawn.
 */

/** Pixels measured on the long side: a 1/4 unit error at most on the 256 grid. Masks cost resvg the square of the
 * size (the seal: 0.24 s at 512, 1.3 s at 1024, 5.5 s at 2048), so every result is kept in memory per source. */
const MEASURE_PX = 1024;
export const PNG_SIZES = [2048, 1024, 400] as const;
/** Logos hold no text: never scan the machine's fonts (seconds per render on a Mac). */
const NO_FONTS = { loadSystemFonts: false } as const;
const cache = new Map<string, string | Buffer>();

function cached<T extends string | Buffer>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = make();
  if (cache.size > 64) cache.clear();
  cache.set(key, value);
  return value;
}
export type PngSize = (typeof PNG_SIZES)[number];

type ViewBox = { x: number; y: number; w: number; h: number };

function viewBoxOf(svg: string): ViewBox {
  const m = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg);
  if (!m) throw new Error("Logo SVG has no viewBox on its <svg> element");
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error(`Logo SVG has a bad viewBox "${m[1]}"`);
  return { x, y, w, h };
}

/** The box of every pixel with any opacity, in pixels of an image `width` x `height`. */
export function alphaBox(pixels: Uint8Array | Buffer, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("Logo SVG draws nothing");
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The SVG with its viewBox cropped to the drawn artwork and width / height set to the same proportions. */
export function tightSvg(svg: string): string {
  return cached(`svg:${svg}`, () => measureTight(svg));
}

function measureTight(svg: string): string {
  const vb = viewBoxOf(svg);
  const scale = MEASURE_PX / Math.max(vb.w, vb.h);
  const img = new Resvg(svg, { font: NO_FONTS, fitTo: { mode: "zoom", value: scale } }).render();
  const b = alphaBox(img.pixels, img.width, img.height);
  const unitX = vb.w / img.width;
  const unitY = vb.h / img.height;
  const x = round(vb.x + b.x0 * unitX);
  const y = round(vb.y + b.y0 * unitY);
  const w = round((b.x1 - b.x0) * unitX);
  const h = round((b.y1 - b.y0) * unitY);
  const long = Math.max(w, h);
  return svg.replace(/<svg\b[^>]*>/, (open) =>
    open
      .replace(/\sviewBox="[^"]*"/, ` viewBox="${x} ${y} ${w} ${h}"`)
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "")
      .replace(/^<svg\b/, `<svg width="${round((256 * w) / long)}" height="${round((256 * h) / long)}"`),
  );
}

/** A PNG of the tight SVG, `size` px on its long side, transparent background. */
export function logoPng(svg: string, size: PngSize): Buffer {
  return cached(`png:${size}:${svg}`, () => renderPng(svg, size));
}

function renderPng(svg: string, size: PngSize): Buffer {
  const tight = tightSvg(svg);
  const vb = viewBoxOf(tight);
  const fit = vb.w >= vb.h ? ({ mode: "width", value: size } as const) : ({ mode: "height", value: size } as const);
  return new Resvg(tight, { font: NO_FONTS, fitTo: fit }).render().asPng();
}
