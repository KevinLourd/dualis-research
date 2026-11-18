import { REPO } from "@/content/dispatch";

/**
 * The design system page reads design/ from GitHub main at request time (raw.githubusercontent.com, its CDN keeps a
 * file at most 5 minutes): a merged edit shows here without a console deploy. A few small text fetches, no parsing
 * beyond one JSON: cheap on the Workers CPU allowance. Fails loud when GitHub does not answer.
 */
export const DESIGN_RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
export const DESIGN_ON_GITHUB = `https://github.com/${REPO}/tree/main/design`;
export const SKILL_ZIP = `https://github.com/${REPO}/releases/download/design-skill/dualis-charts.zip`;

export type ColorTokenDef = { name: string; value: { light: string; dark: string }; usage: string };
export type TypeStyle = { name: string; fontSize: string; lineHeight: string; fontWeight: number };
export type DesignTokens = {
  name: string;
  version: number;
  color: { tokens: ColorTokenDef[] };
  type: { families: Record<"serif" | "sans" | "mono", string>; groups: { name: string; family: "serif" | "sans" | "mono"; styles: TypeStyle[] }[] };
  spacing: { tokens: { name: string; value: string; usage: string }[] };
  radius: { tokens: { name: string; value: string; usage: string }[] };
  chart: {
    usage: string;
    themes: Record<"dark" | "light", { background: string; grid: string; baseline: string; text: string; axis: string; series: string[] }>;
    rules: string[];
  };
  /** `pngSizes`: the PNG downloads offered, px on the long side (default 1024 and 2048). */
  logos: { file: string; usage: string; pngSizes?: number[] }[];
  components: { name: string; path: string }[];
};

export type DesignSystem = {
  tokens: DesignTokens;
  logos: { file: string; usage: string; name: string; pngSizes: number[]; dataUri: string }[];
  components: { name: string; height: number; srcDoc: string }[];
  /** tokens.css + bundle.css, for any preview drawn in an iframe. */
  previewCss: string;
};

export async function raw(path: string, f: typeof fetch): Promise<string> {
  const res = await f(`${DESIGN_RAW}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res.text();
}

/** A component preview (design/components/<Name>/preview.html) as an iframe document with the design's CSS. */
export function previewDoc(html: string, css: string): { height: number; srcDoc: string } {
  const height = Number(/@dsCard[^>]*height=(\d+)/.exec(html)?.[1] ?? 160);
  const body = html.replace(/<!--\s*@dsCard[^>]*-->\s*/, "");
  const style = `<style>${css}</style>`;
  const srcDoc = body.includes("<head>") ? body.replace("<head>", `<head>${style}`) : `${style}${body}`;
  return { height, srcDoc };
}

export async function getDesignSystem(f: typeof fetch = fetch): Promise<DesignSystem> {
  const tokens = JSON.parse(await raw("design/tokens.json", f)) as DesignTokens;
  const [tokensCss, bundleCss, logoSvgs, componentHtml] = await Promise.all([
    raw("design/tokens.css", f),
    raw("design/components/bundle.css", f),
    Promise.all(tokens.logos.map((l) => raw(l.file, f))),
    Promise.all(tokens.components.map((c) => raw(c.path, f))),
  ]);
  // bundle.css opens on an @import (Google Fonts): it goes first.
  const previewCss = `${bundleCss}\n${tokensCss}`;
  return {
    tokens,
    previewCss,
    logos: tokens.logos.map((l, i) => ({ ...l, name: logoName(l.file), pngSizes: l.pngSizes ?? [1024, 2048], dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvgs[i])}` })),
    components: tokens.components.map((c, i) => ({ name: c.name, ...previewDoc(componentHtml[i], previewCss) })),
  };
}

/** A token's value on a theme; throws on a name the design system does not have. */
export function colorValue(tokens: DesignTokens, name: string, theme: "light" | "dark" = "light"): string {
  const t = tokens.color.tokens.find((c) => c.name === name);
  if (!t) throw new Error(`design/tokens.json has no colour "${name}"`);
  return t.value[theme];
}

/** The SVG source of one logo of design/tokens.json `logos`, by its file name without `.svg`; null when not listed. */
export async function getLogoSource(name: string, f: typeof fetch = fetch): Promise<string | null> {
  const tokens = JSON.parse(await raw("design/tokens.json", f)) as DesignTokens;
  const logo = tokens.logos.find((l) => logoName(l.file) === name);
  return logo ? raw(logo.file, f) : null;
}

/** `design/assets/Logos/dualis-mark.svg` -> `dualis-mark`. */
export function logoName(file: string): string {
  return file.split("/").pop()!.replace(/\.svg$/, "");
}
