import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kpiDrivers } from "@/db/schema/analysis";
import { documentPages, documents } from "@/db/schema/documents";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import type { Complete } from "@/llm/complete";
import { testDb } from "@/test/db";
import { kpiSource, parseCandidates, promoteKpis, reactionAfter } from "./dimensions/kpi-drivers";
import type { SourceContext } from "./types";

/** KPI Drivers (Kevin + Thierry 2026-11-19): candidates from the reports, each tested on every release of 3 years. */

const SYMBOL = "101160.KQ";
const DOC = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);

describe("kpi drivers", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await testDb());
    const bars = Array.from({ length: 300 }, (_, i) => ({ date: day(i), close: 100 + (i >= 101 && i < 120 ? 15 : 0) }));
    await db.insert(gold.priceBars).values(bars.map((b) => ({ symbol: SYMBOL, date: b.date, close: b.close, sources: ["naver"], alternatives: [] })) as never);
    await db.insert(gold.priceBars).values(bars.map((b) => ({ symbol: "^GSPC", date: b.date, close: 5000, sources: ["yahoo"], alternatives: [] })) as never);
    await db.insert(gold.filings).values({ id: "00000000-0000-4000-8000-0000000000f1", symbol: SYMBOL, registry: "dart", filingKey: "f1", form: null, title: "매출액또는손익구조30%변경", filedAt: new Date(`${day(150)}T06:00:00Z`), url: null, language: "ko", sources: ["dart"] } as never);
    for (const [n, d, title] of [[1, 100, "분기보고서 (2026.03)"], [2, 200, "반기보고서 (2026.06)"]] as const) {
      await db.insert(documents).values({ id: DOC(n), symbol: SYMBOL, registry: "dart", kind: "report", form: null, title, filedAt: new Date(`${day(d)}T06:00:00Z`), language: "ko", viewUrl: null, format: "xml", pageCount: 1, sources: ["dart"] } as never);
      await db.insert(documentPages).values({ documentId: DOC(n), page: 1, text: `Operating margin rose to ${n === 1 ? "16.7%" : "17.0%"} on higher utilization.` });
    }
  });
  afterEach(async () => close());

  it("measures the 5 trading days after a release from the last close before it", () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ date: day(i), close: i < 3 ? 100 : 110 }));
    expect(reactionAfter(bars, day(3))).toBeCloseTo(0.1);
    expect(reactionAfter(bars, day(0))).toBeNull();
    expect(reactionAfter(bars, day(8))).toBeNull();
  });

  it("keeps any number of KPIs, a stored series only when it exists", () => {
    const catalog = new Map([["qmetric:operating-margin", {} as never]]);
    expect(parseCandidates(JSON.stringify({ kpis: [] }), catalog)).toEqual([]);
    const got = parseCandidates(JSON.stringify({ kpis: [{ name: "Operating margin", why: "w", series: "qmetric:operating-margin" }, { name: "Utilization", why: "w", series: "made-up", approximation: "revenue / PP&E" }] }), catalog);
    expect(got.map((k) => [k.name, k.series, k.approximation])).toEqual([["Operating margin", "qmetric:operating-margin", null], ["Utilization", null, "revenue / PP&E"]]);
  });

  it("tests each KPI on every release, keeps only quotes printed on their page, stores once", async () => {
    let calls = 0;
    const fake: Complete = async ({ prompt }) => {
      calls++;
      if (prompt.includes("Stored series")) return { text: JSON.stringify({ kpis: [{ name: "Operating margin", why: "Pricing power.", series: null, approximation: null }] }), model: "fake" };
      expect(prompt).toContain("R1 " + day(100) + " results release");
      expect(prompt).toContain("+15.0% over the next 5 trading days");
      expect(prompt).toContain("F1 " + day(150) + " filing");
      expect(prompt).toContain("B1 has exactly 2 rows, one per release and news item (R1, R2)");
      return {
        text: JSON.stringify({
          b1: [
            { event: "R1", bigMove: true, kpiChanged: true, verdict: "confirms", from: "9.5%", to: "16.7%", change: "+7.2 pts", why: "margin jumped, stock +15%", cite: { release: "R1", page: 1, quote: "Operating margin rose to 16.7%" } },
            { event: "R2", bigMove: false, kpiChanged: true, verdict: "invalidates", from: "16.7%", to: "17.0%", change: "+0.3 pts", why: "small move", cite: { release: "R2", page: 1, quote: "not on the page" } },
          ],
          b2: [{ event: "F1", bigMove: false, verdict: "invalidates", from: null, to: null, change: "+30% sales", why: "sales jump disclosed, price flat" }, { event: "R1", verdict: "neutral", why: "not a filing" }],
          level: "weak",
          reason: "Confirms on the May 2026 release, the Jul 2026 one goes against it.",
          signal: "strong",
          signalWhy: null,
          direction: "up",
        }),
        model: "fake",
      };
    };
    const ctx: SourceContext = { env: { CLAUDE_OAUTH_TOKEN: "x" }, fetch, db, complete: fake };
    const out = await kpiSource.fetch(SYMBOL, ctx);
    expect(out.error).toBeUndefined();
    await promoteKpis(db, [{ id: "b", subject: SYMBOL, error: null, payload: out.payload, fetchedAt: new Date() } as never]);
    const [k] = await db.select().from(kpiDrivers);
    // A strong turn needs a strong KPI: a weak one turns weak at most.
    expect(k).toMatchObject({ name: "Operating margin", level: "weak", confirmed: 1, invalidated: 2, signal: "weak", direction: "up" });
    expect(k.rows[0].cite?.quote).toBe("Operating margin rose to 16.7%");
    expect(k.rows[1].cite).toBeNull();
    expect(k.rows[0].reaction).toBeCloseTo(0.15);
    // B1 = the release rows, B2 = only the other filing it listed (a release in B2 is dropped); A = every row where it moved.
    expect(k.rows.map((r) => [r.step, r.kind])).toEqual([["B1", "release"], ["B2", "filing"], ["B1", "release"]]);
    expect(k.rows.filter((r) => r.kpiChanged)).toHaveLength(3);
    await kpiSource.fetch(SYMBOL, ctx);
    expect(calls).toBe(2);
    expect(await db.select().from(silver.judgments)).toHaveLength(2);
  });

  it("never stores an answer that skips a release: the next run asks again", async () => {
    const fake: Complete = async ({ prompt }) => {
      if (prompt.includes("Stored series")) return { text: JSON.stringify({ kpis: [{ name: "Operating margin", why: "w", series: null, approximation: null }] }), model: "fake" };
      expect(prompt).toContain("B1 has exactly 2 rows");
      return { text: JSON.stringify({ b1: [{ event: "R1", verdict: "neutral", why: "x" }], b2: [], level: "none", reason: "r" }), model: "fake" };
    };
    // Asked twice (one repair ask), then loud with the answer's size.
    await expect(kpiSource.fetch(SYMBOL, { env: { CLAUDE_OAUTH_TOKEN: "x" }, fetch, db, complete: fake })).rejects.toThrow(/R2.*chars/);
    const stored = await db.select().from(silver.judgments);
    expect(stored.map((j) => j.subjectKind)).toEqual(["kpi-candidates"]);
  });
});
