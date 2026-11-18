/** Same rule as design/build.mjs COLOR_VALUE: #RRGGBB or rgba(r, g, b, a), the forms the site, console and matplotlib read. */
export const COLOR_VALUE = /^(#[0-9A-Fa-f]{6}|rgba\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(0|1|0?\.\d+)\s*\))$/;
