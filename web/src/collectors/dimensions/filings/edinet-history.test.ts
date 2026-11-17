import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filings } from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { isoDate } from "../../markets";
import { runDimension } from "../../runner";
import type { SourceContext } from "../../types";
import { documentSubjects } from "../filing-documents";
import { watchlist } from "../watchlist";
import { filingsDimension } from ".";
import { EDINET_DAYS, edinet, edinetHistoryWindows } from "./sources";

const DAY = 86_400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);
/** Noon in Tokyo, `days` ago. */
const tokyoNoon = (days: number) => new Date(`${isoDate(ago(days))}T03:00:00Z`);

// Miraial's real cadence: the half-year report the day after its 決算短信, the annual one 44 days after.
const ANNUAL_SUMMARY = tokyoNoon(250);
const HALF_SUMMARY = tokyoNoon(70);
const Q1_SUMMARY = tokyoNoon(160); // since April 2024 no quarterly report follows a Q1 summary
const docOn = (days: number, docID: string, docTypeCode: string, docDescription: string) => ({
  date: isoDate(new Date(tokyoNoon(days).getTime() + 9 * 3_600_000)),
  doc: { docID, secCode: "42380", docTypeCode, docDescription, submitDateTime: `${isoDate(tokyoNoon(days))} 15:00`, withdrawalStatus: "0" },
});
const REPORTS = [
  docOn(250 - 44, "S100ANNUAL", "120", "有価証券報告書－第58期"),
  docOn(70 - 1, "S100HALF", "160", "半期報告書－第59期"),
  docOn(3, "S100BUYBACK", "220", "自己株券買付状況報告書"),
];

const dayCalls: string[] = [];
const fake = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.host !== "api.edinet-fsa.go.jp") throw new Error(`unexpected ${url}`);
  const date = url.searchParams.get("date")!;
  dayCalls.push(date);
  const results = REPORTS.filter((r) => r.date === date).map((r) => r.doc);
  results.push({ docID: "S100OTHER", secCode: "99990", docTypeCode: "120", docDescription: "another company", submitDateTime: `${date} 09:00`, withdrawalStatus: "0" });
  return new Response(JSON.stringify({ metadata: {}, results }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const ctx = (): SourceContext => ({ env: { EDINET_API_KEY: "k" }, fetch: fake });
const edinetOnly = { ...filingsDimension, sources: [edinet], subjects: async () => ["4238.T"] };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  dayCalls.length = 0;
});
afterEach(async () => close());

async function seedSummaries() {
  const rows = [
    { filingKey: "t-annual", title: "2026年１月期 決算短信〔日本基準〕（連結）", filedAt: ANNUAL_SUMMARY },
    { filingKey: "t-annual-fix", title: "（訂正・数値データ訂正）「2026年１月期決算短信〔日本基準〕（連結）」の一部訂正について", filedAt: tokyoNoon(220) },
    { filingKey: "t-q1", title: "2027年１月期 第１四半期決算短信〔日本基準〕（連結）", filedAt: Q1_SUMMARY },
    { filingKey: "t-half", title: "2027年１月期  第２四半期（中間期）決算短信〔日本基準〕（連結）", filedAt: HALF_SUMMARY },
    { filingKey: "t-deck", title: "2027年１月期 第2四半期 決算説明資料", filedAt: HALF_SUMMARY },
  ];
  await db.insert(filings).values(rows.map((r) => ({ ...r, symbol: "4238.T", registry: "tdnet", form: null, url: `https://www.release.tdnet.info/inbs/${r.filingKey}.pdf`, language: "ja", sources: ["tdnet"], bronzeIds: [] })));
}

describe("EDINET history", () => {
  it("one window per 決算短信 (no correction): a few weeks after a quarter, 75 days after a year; future days cut", () => {
    const w = edinetHistoryWindows(
      [
        { filingKey: "a", title: "2026年１月期 決算短信〔日本基準〕（連結）", filedAt: new Date("2026-03-09T06:00:00Z") },
        { filingKey: "h", title: "2027年１月期 第２四半期（中間期）決算短信", filedAt: new Date("2026-09-08T06:00:00Z") },
        { filingKey: "x", title: "（訂正）2026年１月期 決算短信の一部訂正について", filedAt: new Date("2026-04-01T06:00:00Z") },
        { filingKey: "n", title: "2027年１月期 第３四半期決算短信", filedAt: new Date("2026-11-10T06:00:00Z") },
      ],
      new Date("2026-11-18T06:00:00Z"),
    );
    expect(w.map((x) => x.anchor)).toEqual(["n", "h", "a"]);
    const annual = w.find((x) => x.anchor === "a")!;
    expect([annual.dates[0], annual.dates.at(-1), annual.complete]).toEqual(["2026-03-09", "2026-05-23", true]);
    expect(annual.dates).toContain("2026-04-22"); // Miraial's 有価証券報告書
    expect(w.find((x) => x.anchor === "h")!.dates).toHaveLength(31);
    const open = w.find((x) => x.anchor === "n")!;
    expect([open.dates.at(-1), open.complete]).toEqual(["2026-11-18", false]);
  });

  it("finds the reports of past years after their 決算短信, reads each window once, and its documents become readable", async () => {
    await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
    await analyseEveryTicker(db);
    await seedSummaries();

    const first = await runDimension(db, edinetOnly, { trigger: "test", ctx: ctx() });
    expect(first.error).toBeNull();
    const found = await db.select().from(filings).where(and(eq(filings.symbol, "4238.T"), eq(filings.registry, "edinet")));
    expect(found.map((f) => f.filingKey).sort()).toEqual(["S100ANNUAL", "S100BUYBACK", "S100HALF"]);
    expect(found.find((f) => f.filingKey === "S100ANNUAL")).toMatchObject({ form: "120", url: "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/S100ANNUAL.pdf" });
    // Each window stops on its report: the half-year one on its 2nd day, the annual one on its 45th; Q1 reads its 31 days.
    expect(new Set(dayCalls).size).toBe(dayCalls.length);

    // A second run reads only the last 14 days: every window is read through.
    dayCalls.length = 0;
    await runDimension(db, edinetOnly, { trigger: "test", ctx: ctx() });
    expect(dayCalls).toHaveLength(EDINET_DAYS);

    // The documents dimension now reads the EDINET reports, never a 決算短信 whose PDF TDnet no longer serves.
    const subjects = await documentSubjects(db, now);
    const ids = new Map(found.map((f) => [f.id, f.filingKey]));
    expect(subjects.map((s) => ids.get(s.split("|")[2]) ?? s.split("|")[1])).toEqual(["S100HALF", "S100ANNUAL"]);
  });
});
