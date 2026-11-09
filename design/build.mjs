#!/usr/bin/env node
/**
 * design/tokens.json is the ONE source of the Dualis design system. This script writes the files the site, the
 * console and the component previews read, so nobody copies a value by hand:
 *   design/tokens.css            CSS variables for the component previews (light, `.dark` for dark)
 *   site/src/app/tokens.css      `--dualis-*` variables, imported by the site's globals.css
 *   web/src/design/tokens.css    `--dualis-*` variables as light-dark() pairs, imported by the console's globals.css
 *   web/src/design/tokens.ts     the same values typed, for console charts and Clerk
 *
 *   node design/build.mjs            regenerate
 *   node design/build.mjs --check    exit 1 if a generated file differs from tokens.json (CI runs this)
 *   node design/build.mjs --set <token> <light|dark|both> <value>   edit one colour, then regenerate
 *
 * No dependency: runs from the repo root in CI, in the design-edit workflow and on a laptop.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = join(ROOT, "design/tokens.json");
const HEADER = "GENERATED from design/tokens.json by design/build.mjs. Edit tokens.json, never this file.";

/** A colour value the site, the console and matplotlib all read: #RRGGBB or rgba(r, g, b, a). */
export const COLOR_VALUE = /^(#[0-9A-Fa-f]{6}|rgba\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(0|1|0?\.\d+)\s*\))$/;

export function readTokens() {
  return JSON.parse(readFileSync(TOKENS, "utf8"));
}

function colors(t) {
  return t.color.tokens;
}

function scale(t) {
  return [...t.spacing.tokens, ...t.radius.tokens].map((x) => [x.name, x.value]);
}

function previewCss(t) {
  const fam = t.type.families;
  const light = colors(t).map((c) => `  --${c.name}: ${c.value.light};`);
  const dark = colors(t).map((c) => `  --${c.name}: ${c.value.dark};`);
  const rest = [
    `  --font-serif: ${fam.serif};`,
    `  --font-sans: ${fam.sans};`,
    `  --font-mono: ${fam.mono};`,
    ...scale(t).map(([n, v]) => `  --${n}: ${v};`),
  ];
  return `/* ${HEADER} */\n:root {\n${[...light, ...rest].join("\n")}\n}\n.dark {\n${dark.join("\n")}\n}\n`;
}

function siteCss(t) {
  // The website has one light theme: it reads the light value of every token.
  const lines = colors(t).map((c) => `  --dualis-${c.name}: ${c.value.light};`);
  return `/* ${HEADER} */\n:root {\n${lines.join("\n")}\n}\n`;
}

function consoleCss(t) {
  const lines = colors(t).map((c) => `  --dualis-${c.name}: light-dark(${c.value.light}, ${c.value.dark});`);
  return `/* ${HEADER} */\n:root {\n${lines.join("\n")}\n}\n`;
}

function consoleTs(t) {
  const color = Object.fromEntries(colors(t).map((c) => [c.name, { light: c.value.light, dark: c.value.dark }]));
  return [
    `/* ${HEADER} */`,
    "",
    `export const DESIGN_VERSION = ${JSON.stringify(t.version)};`,
    "",
    `export const COLOR = ${JSON.stringify(color, null, 2)} as const;`,
    "",
    "export type ColorToken = keyof typeof COLOR;",
    "",
    `export const FONT = ${JSON.stringify(t.type.families, null, 2)} as const;`,
    "",
  ].join("\n");
}

export function outputs(t = readTokens()) {
  return {
    "design/tokens.css": previewCss(t),
    "site/src/app/tokens.css": siteCss(t),
    "web/src/design/tokens.css": consoleCss(t),
    "web/src/design/tokens.ts": consoleTs(t),
  };
}

/** Sets one colour token. Throws on an unknown token, theme or a value outside COLOR_VALUE. */
export function setColor(t, name, theme, value) {
  const token = colors(t).find((c) => c.name === name);
  if (!token) throw new Error(`Unknown colour token "${name}". Known: ${colors(t).map((c) => c.name).join(", ")}`);
  if (!["light", "dark", "both"].includes(theme)) throw new Error(`Theme must be light, dark or both, got "${theme}"`);
  if (!COLOR_VALUE.test(value)) throw new Error(`"${value}" is not a colour: use #RRGGBB or rgba(r, g, b, a)`);
  const v = value.startsWith("#") ? value.toUpperCase() : value;
  if (theme !== "dark") token.value.light = v;
  if (theme !== "light") token.value.dark = v;
  return t;
}

function write(files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), body);
  }
}

/** Generated files that differ from tokens.json, by path. */
export function drift(files = outputs()) {
  return Object.entries(files)
    .filter(([rel, body]) => {
      try {
        return readFileSync(join(ROOT, rel), "utf8") !== body;
      } catch {
        return true;
      }
    })
    .map(([rel]) => rel);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "--check") {
    const stale = drift();
    if (stale.length) {
      console.error(`Out of date with design/tokens.json: ${stale.join(", ")}. Run: node design/build.mjs`);
      process.exit(1);
    }
    console.log("Design tokens: every generated file matches design/tokens.json.");
  } else if (cmd === "--set") {
    const [name, theme, value] = args;
    const t = setColor(readTokens(), name, theme, value);
    writeFileSync(TOKENS, `${JSON.stringify(t, null, 2)}\n`);
    write(outputs(t));
    console.log(`${name} (${theme}) = ${value}`);
  } else {
    write(outputs());
    console.log(`Wrote ${Object.keys(outputs()).join(", ")}`);
  }
}
