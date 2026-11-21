import { beforeAll, describe, expect, it } from "vitest";
import { callCoverTool, coverLink } from "./cover-tools";
import { coverDate, coverSvg, parseCommons, pickReport, sizeOf, type Report } from "./covers";
import { connectorHelpPage } from "./help-page";
import { unseal } from "./oauth";
import { GET as coverRoute } from "../app/covers/[file]/route";
import { GET as mcpGet } from "../app/mcp/route";

/** Width and height from a PNG's header. */
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

beforeAll(() => {
  process.env.MCP_OAUTH_KEY = "test-key-not-a-secret";
});

const report = (id: string, title: string): Report => ({ id, title, url: "u", publishedAt: "2026-10-09T00:00:00Z", shelf: "Deep Dive", photo: null });
const noFetch = (() => {
  throw new Error("no network in this test");
}) as unknown as typeof fetch;

describe("report covers", () => {
  it("draws the site's cover: shelf, serif title, date, mark and brand, photo behind the veil", () => {
    const svg = coverSvg({ title: "Quantum (QMCO): The Tape Runs Out", shelf: "Deep Dive", date: "Oct 9, 2026", photo: null }, { width: 1456, height: 1048 }, "data:image/jpeg;base64,AA==");
    expect(svg).toContain('width="1456" height="1048"');
    expect(svg).toContain("Deep Dive");
    expect(svg).toContain("Oct 9, 2026");
    expect(svg).toContain("Dualis Research");
    expect(svg).toContain("Newsreader");
    expect(svg).toMatch(/<image href="data:image\/jpeg;base64,AA=="/);
  });

  it("sizes: Substack by default, named formats, or width and height", () => {
    expect(sizeOf({})).toEqual({ width: 1456, height: 1048 });
    expect(sizeOf({ format: "x" })).toEqual({ width: 1600, height: 900 });
    expect(sizeOf({ width: 1000, height: 500 })).toEqual({ width: 1000, height: 500 });
    expect(() => sizeOf({ width: 1000 })).toThrow(/both given/);
    expect(() => sizeOf({ format: "poster" })).toThrow(/substack/);
  });

  it("finds a report by id or title words, and says when the words are ambiguous", () => {
    const all = [report("a1", "Quantum (QMCO): The Tape Runs Out"), report("b2", "The Debasement Trade – Part 1"), report("c3", "The Debasement Trade – Part 2")];
    expect(pickReport(all, "tape runs").id).toBe("a1");
    expect(pickReport(all, "c3").id).toBe("c3");
    expect(() => pickReport(all, "debasement")).toThrow(/2 reports match/);
    expect(() => pickReport(all, "nvidia")).toThrow(/list_report_covers/);
    expect(coverDate("2026-11-21")).toBe("Nov 21, 2026");
  });

  it("makes a new cover: a chat preview and a sealed full-size link the route renders with no sign-in", async () => {
    const r = await callCoverTool("make_cover", { title: "Miraial: The Wafer Box Cycle Turns", shelf: "Update", date: "2026-11-21" }, { fetch: noFetch });
    const [image, text] = r!.content as [{ type: "image"; data: string }, { type: "text"; text: string }];
    expect(image.type).toBe("image");
    expect(pngSize(Buffer.from(image.data, "base64")).width).toBe(640);
    const link = /https:\/\/\S+\.png\?name=\S+/.exec(text.text)![0];
    expect(link).toMatch(/\/covers\/.+\.png\?name=miraial-the-wafer-box-cycle-turns-1456x1048\.png$/);

    const file = new URL(link).pathname.split("/").pop()!;
    const res = await coverRoute(new Request(link), { params: Promise.resolve({ file }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1456, height: 1048 });
  });

  it("refuses a photo that is not a Commons file, and a forged or expired link", async () => {
    await expect(callCoverTool("make_cover", { title: "X", photo_url: "https://example.com/ai.png" }, { fetch: noFetch })).rejects.toThrow(/find_cover_photos/);
    const bad = await coverRoute(new Request("https://c/covers/abc.png"), { params: Promise.resolve({ file: "abc.png" }) });
    expect(bad.status).toBe(404);
    const link = coverLink({ title: "T", shelf: "Other", date: null, photo: null }, { width: 400, height: 300 });
    expect(unseal(new URL(link).pathname.split("/").pop()!.replace(/\.png$/, ""), "access")).toBeNull();
  });
});

describe("photo search for a new cover", () => {
  it("keeps Commons photos 1000 px wide or more, credits author and licence, links the file page", () => {
    const info = (url: string, width: number, mime = "image/jpeg") => ({
      url: `${url}?utm_source=commons`,
      width,
      height: 900,
      mime,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Wafer.jpg",
      extmetadata: { LicenseShortName: { value: "CC BY 4.0" }, Artist: { value: '<a href="x">Purdue Engineering</a>' }, ObjectName: { value: "A wafer" } },
    });
    const found = parseCommons({
      query: {
        pages: {
          "2": { index: 2, title: "File:Small.jpg", imageinfo: [info("https://upload.wikimedia.org/wikipedia/commons/a/ab/Small.jpg", 600)] },
          "1": { index: 1, title: "File:Wafer.jpg", imageinfo: [info("https://upload.wikimedia.org/wikipedia/commons/b/b8/Wafer.jpg", 3000)] },
          "3": { index: 3, title: "File:Logo.svg", imageinfo: [info("https://upload.wikimedia.org/wikipedia/commons/c/cd/Logo.svg", 3000, "image/svg+xml")] },
        },
      },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "A wafer", credit: "Photo: Purdue Engineering, CC BY 4.0", link: "https://commons.wikimedia.org/wiki/File:Wafer.jpg" });
    expect(found[0].photo_url).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Wafer.jpg/2048px-Wafer.jpg");
  });
});

describe("connector address opened in a browser", () => {
  it("shows how to add it in Claude Desktop; Claude itself still gets the OAuth challenge", async () => {
    const page = await mcpGet(new Request("https://c/mcp", { headers: { accept: "text/html,application/xhtml+xml" } }));
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/Add custom connector/);
    const claude = await mcpGet(new Request("https://c/mcp", { headers: { accept: "text/event-stream" } }));
    expect(claude.status).toBe(401);
    expect(claude.headers.get("www-authenticate")).toMatch(/resource_metadata/);
    expect((await connectorHelpPage().text()).includes("/mcp")).toBe(true);
  });
});
