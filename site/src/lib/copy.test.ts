import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every source file of the site (pages, components, styles, model). */
function sources(dir = join(__dirname, "..")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fonts" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("site copy and colours", () => {
  const files = sources().map((path) => ({ path, text: readFileSync(path, "utf8") }));

  // Kevin 2026-11-06: Thierry is the founder and lead analyst of Dualis Research, never a fund manager; the
  // portfolio size is not an identity ("2-4 names", "concentrated" hidden for now).
  it.each([/Duality/i, /fund manager/i, /concentrated/i, /two to four/i, /2 - 4/, /own capital/i])("never says %s", (banned) => {
    expect(files.filter((f) => banned.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  // Kevin 2026-11-06: dark professional indigo, no light purple anywhere.
  it.each(["#eceaf5", "#f5f4f9", "#b9b2ea", "#8c82d8", "#e3e1ec"])("never paints the light purple %s", (hex) => {
    expect(files.filter((f) => f.text.toLowerCase().includes(hex)).map((f) => f.path)).toEqual([]);
  });

  // Kevin 2026-11-06: the inner pages stop copying Aurelion Research's blocks and lines.
  it.each(["What we publish", "Our investment framework", "every step is communicated", "See the research at work", "Global distribution", "Strategy snapshot", "Independent.", "From overlooked companies"])(
    "drops the Aurelion block %s",
    (line) => {
      expect(files.filter((f) => f.text.includes(line)).map((f) => f.path)).toEqual([]);
    },
  );
});
