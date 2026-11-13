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
  it.each([/Duality/i, /fund manager/i, /concentrated/i, /two to four/i, /2 - 4/, /own capital/i, /Astana/, /Kazakh/])("never says %s", (banned) => {
    expect(files.filter((f) => banned.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  // Kevin 2026-11-06: "Written for investors, never for the companies we cover" = AI-slop structure. No "X, never Y"
  // in any copy string (comments aside).
  it("never writes the contrast template \"X, never Y\"", () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(files.filter((f) => /"[^"\n]*, never [^"\n]*"|>[^<\n]*, never [^<\n]*</.test(strip(f.text))).map((f) => f.path)).toEqual([]);
  });

  // Thierry 2026-11-06: "Every position starts as a published report. I don't know if that's going to be true. Some
  // positions I just have are notes... Some positions come from a friend." No line ties a position to a report.
  it.each(["Every position starts as a published report", "buys what he writes up", "traces back to a report", "behind each position"])(
    "never ties a position to a report: %s",
    (line) => {
      expect(files.filter((f) => f.text.includes(line)).map((f) => f.path)).toEqual([]);
    },
  );

  // Thierry 2026-11-09: « remove my name from the website almost entirely… keep it in one place, the about page ».
  // The legal pages name him as the publisher (Kevin 2026-11-11).
  it("names Thierry on About and the legal pages only", () => {
    const allowed = [join("app", "team", "page.tsx"), join("app", "disclaimer", "page.tsx"), join("lib", "legal.ts")];
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const named = files.filter((f) => !allowed.some((a) => f.path.endsWith(a)) && /Thierry|Matin/.test(strip(f.text)));
    expect(named.map((f) => f.path)).toEqual([]);
  });

  // Thierry 2026-11-09: no Portfolio page, no track record or list of calls on Company.
  it("has no Portfolio page or link, and Company shows no calls", () => {
    expect(files.filter((f) => f.text.includes('"/portfolio"')).map((f) => f.path)).toEqual([]);
    const company = files.find((f) => f.path.endsWith(join("app", "company", "page.tsx")));
    expect(company?.text).not.toMatch(/CallsBoard|Track record|Every published call/);
  });

  // Kevin 2026-11-11: engraved playing cards are the site's thread (Research hand, Company cards), static like everything else.
  // Thierry 2026-11-12: « remove everywhere the small card icon » before the poker lines.
  it("deals the winnable games as cards, never animated", () => {
    const text = (end: string) => files.find((f) => f.path.endsWith(end))?.text ?? "";
    expect(text(join("app", "research", "page.tsx"))).toContain("<Hand ");
    expect(text(join("app", "company", "page.tsx"))).toContain("<PlayingCard ");
    expect(files.filter((f) => /CardGlyph|card-glyph/.test(f.text)).map((f) => f.path)).toEqual([]);
    const css = text(join("app", "globals.css"));
    const cardRules = css.match(/\.(pcard|pc-[a-z]+|hand[a-z-]*)[^{]*\{[^}]*\}/g) ?? [];
    expect(cardRules.length).toBeGreaterThan(5);
    expect(cardRules.filter((r) => /transition|animation/.test(r))).toEqual([]);
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
