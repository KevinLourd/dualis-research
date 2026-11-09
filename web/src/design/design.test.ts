import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkColorEdit, COLOR_VALUE } from "./color";
import { DESIGN_RAW, getDesignSystem, previewDoc } from "./queries";

const ROOT = join(__dirname, "../../..");
// design/build.mjs is plain Node with no dependency: the test imports it as is.
const build = (await import(/* @vite-ignore */ join(ROOT, "design/build.mjs"))) as {
  drift: () => string[];
  readTokens: () => { color: { tokens: { name: string; value: { light: string; dark: string } }[] } };
  setColor: (t: unknown, name: string, theme: string, value: string) => { color: { tokens: { name: string; value: { light: string; dark: string } }[] } };
  COLOR_VALUE: RegExp;
};

describe("design tokens: one source", () => {
  it("every generated file matches design/tokens.json (run node design/build.mjs after an edit)", () => {
    expect(build.drift()).toEqual([]);
  });

  it("the site and the console type no colour of their own", () => {
    const site = readFileSync(join(ROOT, "site/src/app/globals.css"), "utf8");
    const root = site.slice(site.indexOf(":root {"), site.indexOf("}", site.indexOf(":root {")));
    expect(root).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const consoleCss = readFileSync(join(ROOT, "web/src/app/globals.css"), "utf8");
    const theme = consoleCss.slice(consoleCss.indexOf("@theme {"), consoleCss.indexOf("}", consoleCss.indexOf("@theme {")));
    expect(theme).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("an edit sets one colour and refuses what the site cannot read", () => {
    const t = build.setColor(build.readTokens(), "brand", "light", "#112233");
    expect(t.color.tokens.find((c) => c.name === "brand")?.value.light).toBe("#112233");
    expect(() => build.setColor(build.readTokens(), "nope", "light", "#112233")).toThrow(/Unknown colour token/);
    expect(() => build.setColor(build.readTokens(), "brand", "light", "indigo")).toThrow(/not a colour/);
    expect(String(build.COLOR_VALUE)).toBe(String(COLOR_VALUE));
  });

  it("the console checks an edit before starting GitHub", () => {
    expect(checkColorEdit({ name: " brand ", light: "#2B2463 ", dark: "rgba(255, 255, 255, 0.8)" })).toEqual({ name: "brand", light: "#2B2463", dark: "rgba(255, 255, 255, 0.8)" });
    expect(() => checkColorEdit({ name: "brand", light: "#2B246", dark: "#000000" })).toThrow(/not a colour/);
  });
});

describe("design system page reads GitHub live", () => {
  const files: Record<string, string> = {
    "design/tokens.json": readFileSync(join(ROOT, "design/tokens.json"), "utf8"),
    "design/tokens.css": ":root { --brand: #2B2463; }",
    "design/components/bundle.css": "@import url(fonts); .dr-tag { color: var(--long); }",
  };
  const fake = vi.fn<typeof fetch>(async (input) => {
    const path = String(input).slice(DESIGN_RAW.length);
    const body = files[path] ?? (path.endsWith(".svg") ? "<svg/>" : path.endsWith(".html") ? '<!-- @dsCard height=96 -->\n<html><head></head><body>x</body></html>' : null);
    return body === null ? new Response("404", { status: 404 }) : new Response(body);
  });

  it("returns tokens, logos and component previews with the design CSS", async () => {
    const ds = await getDesignSystem(fake);
    expect(ds.tokens.color.tokens.length).toBeGreaterThan(10);
    expect(ds.logos[0].dataUri).toMatch(/^data:image\/svg\+xml/);
    expect(ds.components[0]).toMatchObject({ height: 96 });
    expect(ds.components[0].srcDoc).toContain("<head><style>@import url(fonts)");
    expect(fake.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
  });

  it("fails loud when GitHub does not answer", async () => {
    await expect(getDesignSystem(async () => new Response("down", { status: 503 }))).rejects.toThrow(/GitHub answered 503/);
  });

  it("a preview without a head still gets the CSS", () => {
    expect(previewDoc("<div>x</div>", "a{}").srcDoc).toBe("<style>a{}</style><div>x</div>");
  });
});
