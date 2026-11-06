import { describe, expect, it } from "vitest";
import { categoryLabel, constellation, formatDate, formatMonth, seeded, shelf, subscribeHref } from "./model";

describe("links and dates", () => {
  it("builds the Substack subscribe link, or none until it is set", () => {
    expect(subscribeHref("https://analysisparalysis888.substack.com/")).toBe("https://analysisparalysis888.substack.com/subscribe");
    expect(subscribeHref(null)).toBeNull();
  });
  it("prints dates", () => {
    expect(formatDate("2026-10-09T12:00:00.000Z")).toBe("Oct 9, 2026");
    expect(formatMonth("2026-06-01")).toBe("June 2026");
    expect(formatDate(null)).toBeNull();
  });
});

describe("research portal shelves", () => {
  const posts = [
    { id: "a", category: "coverage" as const },
    { id: "b", category: "memo" as const },
    { id: "c", category: null },
  ];
  it("files each post on its shelf; one not filed yet shows only under All", () => {
    expect(shelf(posts, "all").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(shelf(posts, "coverage").map((p) => p.id)).toEqual(["a"]);
    expect(shelf(posts, "primer")).toEqual([]);
    expect(categoryLabel("primer")).toBe("Primers");
    expect(categoryLabel(null)).toBe("Research");
  });
});

describe("covers and constellations", () => {
  it("are the same for the same seed and differ across seeds", () => {
    expect(seeded("x")()).toBe(seeded("x")());
    expect(seeded("x")()).not.toBe(seeded("y")());
    const a = constellation("post-1", 400, 300);
    expect(constellation("post-1", 400, 300)).toEqual(a);
    expect(constellation("post-2", 400, 300)).not.toEqual(a);
  });
  it("links every industry to the next one and stays inside the box", () => {
    const { nodes, edges } = constellation("seed", 600, 400, 5, 6);
    expect(nodes).toHaveLength(30);
    expect(edges.filter((e) => e.cross)).toHaveLength(8);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(600);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(400);
    }
  });
});
