/**
 * The Sandbox accounts' logos (Kevin 2026-11-13): one white symbol per account on its own colour, drawn on a 100 x 100
 * grid kept inside the central circle so X's round crop never cuts it. Plain SVG strings: the avatar renders them, and
 * the download turns the same string into the 400 x 400 PNG X takes as a profile picture.
 *   - sirensmallcaps (urgent): an alarm light with its rays.
 *   - narrativegap (balanced): two lines leaving one point, price solid and value dashed, the gap between them.
 *   - ledgerlens (neutral): a lens over the lines of a ledger.
 */

const W = "#ffffff";

const GLYPHS: Record<string, string> = {
  sirensmallcaps: [
    `<path d="M33 66 V50 a17 17 0 0 1 34 0 V66 Z" fill="${W}"/>`,
    `<rect x="27" y="66" width="46" height="9" rx="2.5" fill="${W}"/>`,
    `<g stroke="${W}" stroke-width="4.5" stroke-linecap="round">`,
    `<line x1="50" y1="15" x2="50" y2="24"/><line x1="25" y1="25" x2="31" y2="31"/><line x1="75" y1="25" x2="69" y2="31"/>`,
    `<line x1="15" y1="48" x2="23" y2="48"/><line x1="85" y1="48" x2="77" y2="48"/></g>`,
  ].join(""),
  narrativegap: [
    `<g stroke="${W}" stroke-width="6" stroke-linecap="round" fill="none">`,
    `<line x1="22" y1="52" x2="78" y2="28"/>`,
    `<line x1="22" y1="52" x2="78" y2="76" stroke-dasharray="7 7"/></g>`,
    `<circle cx="22" cy="52" r="6" fill="${W}"/>`,
  ].join(""),
  ledgerlens: [
    `<g stroke="${W}" stroke-width="5" stroke-linecap="round" fill="none">`,
    `<line x1="18" y1="28" x2="62" y2="28"/><line x1="18" y1="42" x2="38" y2="42"/><line x1="18" y1="56" x2="36" y2="56"/><line x1="18" y1="70" x2="38" y2="70"/>`,
    `<circle cx="60" cy="56" r="14" stroke-width="6"/><line x1="70" y1="66" x2="80" y2="76" stroke-width="7"/></g>`,
  ].join(""),
};

export const hasLogo = (handle: string): boolean => handle.toLowerCase() in GLYPHS;

/** The logo as an SVG string: transparent (the avatar paints the colour) or on a full square of `background` (download). */
export function logoSvg(handle: string, opts: { size: number; background?: string }): string {
  const glyph = GLYPHS[handle.toLowerCase()];
  if (!glyph) throw new Error(`no logo for @${handle}`);
  const bg = opts.background ? `<rect width="100" height="100" fill="${opts.background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${opts.size}" height="${opts.size}">${bg}${glyph}</svg>`;
}
