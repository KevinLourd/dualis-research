/** Same rule as design/build.mjs COLOR_VALUE: #RRGGBB or rgba(r, g, b, a), the forms the site, console and matplotlib read. */
export const COLOR_VALUE = /^(#[0-9A-Fa-f]{6}|rgba\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(0|1|0?\.\d+)\s*\))$/;

export type ColorEdit = { name: string; light: string; dark: string };

/** Trims and checks an edit; throws a sentence Thierry can act on. */
export function checkColorEdit(e: ColorEdit): ColorEdit {
  const name = e.name.trim();
  if (!/^[a-z][a-z-]*$/.test(name)) throw new Error(`"${name}" is not a colour name`);
  const light = e.light.trim();
  const dark = e.dark.trim();
  for (const v of [light, dark]) if (!COLOR_VALUE.test(v)) throw new Error(`"${v}" is not a colour: use #RRGGBB, for example #2B2463`);
  return { name, light, dark };
}
