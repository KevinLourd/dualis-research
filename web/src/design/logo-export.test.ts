import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it, vi } from "vitest";
import { alphaBox, logoPng, tightSvg } from "./logo-export";
import { DESIGN_RAW, getLogoSource, logoName } from "./queries";

const ROOT = join(__dirname, "../../..");
const tokens = JSON.parse(readFileSync(join(ROOT, "design/tokens.json"), "utf8")) as { logos: { file: string; pngSizes?: number[] }[] };
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);

function pngInfo(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("logo downloads", () => {
  it.each(tokens.logos.map((l) => l.file))("%s: the PNG is a real PNG cropped to the artwork", (file) => {
    const png = logoPng(source(file), 400);
    const { width, height } = pngInfo(png);
    expect(Math.max(width, height)).toBe(400);
    const img = new Resvg(tightSvg(source(file)), { font: { loadSystemFonts: false }, fitTo: { mode: "width", value: 1024 } }).render();
    const b = alphaBox(img.pixels, img.width, img.height);
    // The artwork touches every edge: at most 2 px of margin on a 1024 px image.
    expect(b.x0).toBeLessThanOrEqual(2);
    expect(b.y0).toBeLessThanOrEqual(2);
    expect(img.width - b.x1).toBeLessThanOrEqual(2);
    expect(img.height - b.y1).toBeLessThanOrEqual(2);
  });

  it.each(tokens.logos.map((l) => l.file))("%s: the source viewBox is already tight (no empty margin in the master)", (file) => {
    const src = viewBox(source(file));
    const tight = viewBox(tightSvg(source(file)));
    src.forEach((v, i) => expect(Math.abs(v - tight[i])).toBeLessThanOrEqual(0.5));
  });

  it("the bare mark is transparent around the knot, the avatar is a full indigo square", () => {
    const mark = new Resvg(tightSvg(source("design/assets/Logos/dualis-mark.svg")), { font: { loadSystemFonts: false }, fitTo: { mode: "width", value: 512 } }).render();
    expect(mark.pixels[3]).toBe(0); // top-left corner: nothing drawn, transparent
    const avatar = new Resvg(tightSvg(source("design/assets/Logos/dualis-avatar.svg")), { font: { loadSystemFonts: false }, fitTo: { mode: "width", value: 512 } }).render();
    expect([...avatar.pixels.subarray(0, 4)]).toEqual([0x2b, 0x24, 0x63, 255]);
    expect(pngInfo(logoPng(source("design/assets/Logos/dualis-avatar.svg"), 400))).toEqual({ width: 400, height: 400 });
  });

  it("a logo is found by its file name, an unknown name is null", async () => {
    const f = vi.fn<typeof fetch>(async (input) => {
      const path = String(input).slice(DESIGN_RAW.length);
      return new Response(source(path));
    });
    expect(logoName(tokens.logos[0].file)).toBe("dualis-mark");
    expect(await getLogoSource("dualis-mark", f)).toBe(source("design/assets/Logos/dualis-mark.svg"));
    expect(await getLogoSource("nope", f)).toBeNull();
  });

  it("an SVG that draws nothing fails loud", () => {
    expect(() => tightSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>')).toThrow(/draws nothing/);
  });
});
