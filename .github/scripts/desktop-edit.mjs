#!/usr/bin/env node
/**
 * Applies one change asked from Claude Desktop through the console's connector (web/src/connector/, workflow
 * desktop-edit.yml): exact text replacements in the design system and the website's source, plus colour values set
 * through design/build.mjs. Plain Node, no dependency; the console checks the same rules before it starts the run.
 *
 *   CHANGE='{"summary":"...","edits":[{"path":"site/src/app/page.tsx","find":"old","replace":"new"}],
 *            "colours":[{"name":"chart-line","light":"#8B5CF6","dark":"#C77DFF"}]}' node .github/scripts/desktop-edit.mjs
 *
 * Writes `design=true|false` and `site=true|false` to $GITHUB_OUTPUT. Any refusal prints a GitHub `::error::` line
 * (the connector reads it back to Claude) and exits 1, so nothing is committed.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** What Thierry's Claude may change: the design tokens and the site's own source (never a generated file or a test). */
export function editablePath(path) {
  if (typeof path !== "string" || path.includes("..") || path.startsWith("/")) return false;
  if (path === "design/tokens.json") return true;
  if (/^\.claude\/skills\/[a-z0-9-]+\/[^/]+\.(md|py)$/.test(path)) return true;
  if (!/^site\/src\/.+\.(tsx|ts|css)$/.test(path)) return false;
  return path !== "site/src/app/tokens.css" && !path.endsWith(".test.ts");
}

/** Replaces `find` with `replace` in `text`; `find` must appear exactly once, so the change lands where it was meant. */
export function replaceOnce(text, find, replace, path) {
  if (typeof find !== "string" || !find) throw new Error(`${path}: the text to find is empty`);
  if (typeof replace !== "string") throw new Error(`${path}: the replacement text is missing`);
  const first = text.indexOf(find);
  if (first < 0) throw new Error(`${path}: text not found: ${JSON.stringify(find.slice(0, 120))}. Read the file again: it may have changed.`);
  if (text.indexOf(find, first + 1) >= 0) throw new Error(`${path}: the text appears more than once: ${JSON.stringify(find.slice(0, 120))}. Include more of the line around it.`);
  return text.slice(0, first) + replace + text.slice(first + find.length);
}

/** The change as the connector sends it. Throws on anything outside the contract. */
export function parseChange(raw) {
  const change = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!change || typeof change !== "object") throw new Error("The change must be a JSON object");
  const summary = typeof change.summary === "string" ? change.summary.trim() : "";
  if (!summary) throw new Error("The change needs a summary (one line, what changed)");
  if (summary.length > 120 || summary.includes("\n")) throw new Error("The summary must be one line of at most 120 characters");
  const edits = change.edits ?? [];
  const colours = change.colours ?? [];
  if (!Array.isArray(edits) || !Array.isArray(colours)) throw new Error("edits and colours must be lists");
  if (!edits.length && !colours.length) throw new Error("Nothing to change: give at least one edit or one colour");
  for (const e of edits) {
    if (!editablePath(e?.path)) throw new Error(`Not editable from Claude Desktop: ${e?.path}. Allowed: design/tokens.json, .claude/skills/<skill>/*.md|py and the site's source under site/src/ (pages, components, styles, model).`);
  }
  for (const c of colours) {
    if (typeof c?.name !== "string" || (c.light === undefined && c.dark === undefined)) throw new Error("Each colour needs a token name and a light and/or dark value");
  }
  return { summary, edits, colours };
}

/** Applies the change to the files under `root`. Returns which areas it touched. */
export async function applyChange(change, root = ROOT) {
  const files = new Map();
  const read = (path) => {
    if (!files.has(path)) {
      const full = join(root, path);
      if (!existsSync(full)) throw new Error(`${path}: no such file on main`);
      files.set(path, readFileSync(full, "utf8"));
    }
    return files.get(path);
  };
  for (const e of change.edits) files.set(e.path, replaceOnce(read(e.path), e.find, e.replace, e.path));
  if (change.colours.length) {
    const { setColor } = await import(join(root, "design/build.mjs"));
    let tokens = JSON.parse(read("design/tokens.json"));
    for (const c of change.colours) {
      if (c.light !== undefined) tokens = setColor(tokens, c.name, "light", String(c.light));
      if (c.dark !== undefined) tokens = setColor(tokens, c.name, "dark", String(c.dark));
    }
    files.set("design/tokens.json", `${JSON.stringify(tokens, null, 2)}\n`);
  }
  if (files.has("design/tokens.json")) {
    try {
      JSON.parse(files.get("design/tokens.json"));
    } catch (e) {
      throw new Error(`design/tokens.json would no longer be valid JSON: ${e.message}`);
    }
  }
  for (const [path, text] of files) writeFileSync(join(root, path), text);
  const paths = [...files.keys()];
  return { design: paths.some((p) => p.startsWith("design/")), site: paths.some((p) => p.startsWith("site/")), skills: paths.some((p) => p.startsWith(".claude/skills/")), paths };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const change = parseChange(process.env.CHANGE ?? "");
    const touched = await applyChange(change);
    console.log(`Changed: ${touched.paths.join(", ")}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `design=${touched.design}\nsite=${touched.site}\nskills=${touched.skills}\n`);
  } catch (e) {
    console.log(`::error::${String(e.message).replace(/\r?\n/g, " ")}`);
    process.exit(1);
  }
}
