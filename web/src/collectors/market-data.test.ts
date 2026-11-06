import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeSightings } from "@/bsg/entities";
import * as gold from "@/db/schema/gold";
import * as silver from "@/db/schema/silver";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { companyProfile } from "./dimensions/company-profile";
import { earnings } from "./dimensions/earnings";
import { addQuarters } from "./dimensions/earnings/sources";
import { filingsDimension } from "./dimensions/filings";
import { secTitle } from "./dimensions/filings/sources";
import { price } from "./dimensions/price";
import { priceConsensus } from "./dimensions/price/consensus";
import { cnbcSymbol } from "./dimensions/price/sources";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const env = { REPO_ROOT, FMP_API_KEY: "k", FINNHUB_API_KEY: "k", DART_API_KEY: "k", COMPANIES_HOUSE_API_KEY: "k", EDINET_API_KEY: "k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => new Response("not found", { status: 404 });

/** Three agreeing days for MNRO from Nasdaq, CNBC and Yahoo, except Yahoo's 2026-11-03 close which is off by 10%. */
const MNRO_BARS = [
  { date: "2026-10-30", close: 11.95 },
  { date: "2026-11-02", close: 12.06 },
  { date: "2026-11-03", close: 11.63 },
];

const fake = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const path = url.pathname;
  if (url.host === "api.nasdaq.com") {
    if (!path.includes("/MNRO/")) return json({ data: null });
    if (path.endsWith("/historical")) {
      return json({ data: { tradesTable: { rows: MNRO_BARS.map((b) => ({ date: `${b.date.slice(5, 7)}/${b.date.slice(8)}/${b.date.slice(0, 4)}`, close: `$${b.close}`, open: "$12.00", high: "$12.20", low: "$11.50", volume: "1,000" })) } } });
    }
    if (path.endsWith("/insider-trades")) {
      return json({ data: { transactionTable: { table: { rows: [
        { insider: "SOLOMON PETER J", relation: "Director", lastDate: "8/11/2026", transactionType: "Acquisition (Non Open Market)", sharesTraded: "11,149", lastPrice: "$0.00", sharesHeld: "720,175" },
        { insider: "HYDE LINDSAY", relation: "Director", lastDate: "3/2/2026", transactionType: "Sell", sharesTraded: "500", lastPrice: "$20.10", sharesHeld: "41,877" },
      ] } } } });
    }
    if (path.endsWith("/earnings-surprise")) {
      return json({ data: { earningsSurpriseTable: { rows: [{ fiscalQtrEnd: "Sep 2026", dateReported: "10/29/2026", eps: -0.01, consensusForecast: "0.05" }] } } });
    }
    return json({ data: { summaryData: { Exchange: { value: "NASDAQ-GS" }, Sector: { value: "Consumer Discretionary" }, Industry: { value: "Automotive Aftermarket" }, MarketCap: { value: "364,332,161" } } } });
  }
  if (url.host === "ts-api.cnbc.com") {
    const symbol = url.searchParams.get("symbol");
    const bars = symbol === "MNRO" ? MNRO_BARS : symbol === "4238-JP" ? [{ date: "2026-11-04", close: 1634 }] : [];
    if (!bars.length) return json({ status: "ERROR", statusMessage: "Error in getting bars" });
    return json({ barData: { priceBars: bars.map((b) => ({ open: "-9999401.0000", high: String(b.close), low: String(b.close), close: String(b.close), volume: 10, tradeTime: `${b.date.replace(/-/g, "")}000000` })) } });
  }
  if (url.host === "query1.finance.yahoo.com") {
    const symbol = decodeURIComponent(path.split("/").pop()!);
    const bars = symbol === "MNRO" ? MNRO_BARS.map((b) => (b.date === "2026-11-03" ? { ...b, close: 12.8 } : b)) : symbol === "4238.T" ? [{ date: "2026-11-04", close: 1635 }] : [];
    if (!bars.length) return json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
    return json({ chart: { result: [{ meta: { currency: symbol === "MNRO" ? "USD" : "JPY", gmtoffset: 0 }, timestamp: bars.map((b) => Date.parse(`${b.date}T14:30:00Z`) / 1000), indicators: { quote: [{ close: bars.map((b) => b.close), open: bars.map(() => null), high: bars.map(() => null), low: bars.map(() => null), volume: bars.map(() => 5) }] } }] } });
  }
  if (url.host === "finnhub.io") {
    if (url.searchParams.get("symbol") !== "MNRO") return json({ data: [], earningsCalendar: [] });
    if (path.endsWith("/insider-transactions")) {
      return json({ data: [
        { name: "Solomon Peter J.", share: 720175, change: 11149, filingDate: "2026-08-13", transactionDate: "2026-08-11", transactionCode: "A", transactionPrice: 0, isDerivative: false },
        { name: "OPTION HOLDER", share: 10, change: 10, transactionDate: "2026-08-11", transactionCode: "M", isDerivative: true },
      ] });
    }
    if (path.endsWith("/calendar/earnings")) {
      return json({ earningsCalendar: [
        { symbol: "MNRO", date: "2026-10-29", hour: "bmo", year: 2027, quarter: 2, epsEstimate: 0.05, epsActual: -0.01, revenueEstimate: 289818924, revenueActual: 283638000 },
        { symbol: "MNRO", date: "2027-01-28", hour: "bmo", year: 2027, quarter: 3, epsEstimate: 0.12, epsActual: null, revenueEstimate: 300e6, revenueActual: null },
      ] });
    }
    if (path.endsWith("/stock/earnings")) return json([{ period: "2026-09-30", year: 2027, quarter: 2, estimate: 0.05, actual: -0.01 }]);
    return json({});
  }
  if (url.host === "www.sec.gov") return json({ 0: { cik_str: 876427, ticker: "MNRO" } });
  if (url.host === "data.sec.gov") {
    return json({ cik: "0000876427", name: "MONRO, INC.", filings: { recent: {
      accessionNumber: ["0000876427-26-000045", "0000909061-26-000002"],
      form: ["8-K", "4"],
      filingDate: ["2026-10-29", "2026-08-13"],
      acceptanceDateTime: ["2026-10-29T07:01:02.000Z", "2026-08-13T16:00:00.000Z"],
      primaryDocument: ["mnro-8k.htm", "xslF345X05/form4.xml"],
      primaryDocDescription: ["8-K", "FORM 4"],
      items: ["2.02,9.01", ""],
    } } });
  }
  if (url.host === "webapi.yanoshin.jp") {
    if (!path.includes("/4238.json")) return json({ items: [] });
    return json({ items: [{ Tdnet: { id: "1279642", pubdate: "2026-09-08 14:46:00", title: "2027年1月期 第2四半期決算短信", document_url: "https://webapi.yanoshin.jp/rd.php?https://www.release.tdnet.info/inbs/140120260908532943.pdf" } }] });
  }
  return notFound();
}) as typeof fetch;

/** Every other source (wikidata, TMX, DART...) answers 404 here: tests below look only at the sources they feed. */
const ctx = (): SourceContext => ({ env, fetch: fake });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: ctx() });
  await analyseEveryTicker(db);
});
afterEach(async () => close());

describe("price consensus (pure)", () => {
  const obs = (close: number) => ({ open: null, high: null, low: null, volume: null, close, bronzeId: "b" });
  it("closes within 0.5% are one price carrying every source", () => {
    expect(priceConsensus({ yahoo: obs(10), nasdaq: obs(10.04), cnbc: obs(10.01) })).toEqual({ lead: "nasdaq", sources: ["nasdaq", "cnbc", "yahoo"], alternatives: [] });
  });
  it("a majority beats a more trusted lone source, and the outlier stays visible", () => {
    expect(priceConsensus({ nasdaq: obs(11), cnbc: obs(10), yahoo: obs(10) })).toEqual({ lead: "cnbc", sources: ["cnbc", "yahoo"], alternatives: [{ source: "nasdaq", close: 11 }] });
  });
  it("a tie goes to the more trusted source", () => {
    expect(priceConsensus({ yahoo: obs(10), nasdaq: obs(12) }).lead).toBe("nasdaq");
  });
  it("maps exchange suffixes to CNBC symbols, null where CNBC has none", () => {
    expect([cnbcSymbol("MNRO"), cnbcSymbol("4238.T"), cnbcSymbol("RW.V"), cnbcSymbol("AT.L"), cnbcSymbol("LFLR.CN")]).toEqual(["MNRO", "4238-JP", "RW-V", null, null]);
  });
});

describe("price dimension", () => {
  it("one bar per day with every agreeing source; a disagreeing close stays visible; quote has the day change", async () => {
    const report = await runDimension(db, price, { trigger: "test", ctx: ctx() });
    expect(report.status).toBe("partial");
    const bars = await db.select().from(gold.priceBars).where(eq(gold.priceBars.symbol, "MNRO"));
    expect(bars).toHaveLength(3);
    const nov2 = bars.find((b) => b.date === "2026-11-02")!;
    expect(nov2.sources).toEqual(["nasdaq", "cnbc", "yahoo"]);
    expect(nov2.open).toBe(12); // Nasdaq leads; CNBC's sentinel -9999401 open is never shown
    const nov3 = bars.find((b) => b.date === "2026-11-03")!;
    expect(nov3.sources).toEqual(["nasdaq", "cnbc"]);
    expect(nov3.alternatives).toEqual([{ source: "yahoo", close: 12.8 }]);

    const [quote] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, "MNRO"));
    expect(quote).toMatchObject({ date: "2026-11-03", close: 11.63, previousClose: 12.06, currency: "USD", sources: ["nasdaq", "cnbc"] });
    expect(quote.changePct).toBeCloseTo((11.63 - 12.06) / 12.06, 6);

    const [miraial] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, "4238.T"));
    expect(miraial).toMatchObject({ close: 1634, sources: ["cnbc", "yahoo"], currency: "JPY" });
  });

  it("a second run keeps one row per day and refreshes each source's observation", async () => {
    await runDimension(db, price, { trigger: "test", ctx: ctx() });
    await runDimension(db, price, { trigger: "test", ctx: ctx() });
    const rows = await db.select().from(silver.priceBars).where(eq(silver.priceBars.symbol, "MNRO"));
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0].observations).sort()).toEqual(["cnbc", "nasdaq", "yahoo"]);
  });

  it("a later run leaves stored history alone: only the last PRICE_REWRITE_DAYS are read back and rewritten", async () => {
    await runDimension(db, price, { trigger: "test", ctx: ctx() });
    // An old stored bar a refetch must not touch (a month before the last bar).
    await db.insert(silver.priceBars).values({ symbol: "MNRO", date: "2026-09-01", open: 1, high: 1, low: 1, close: 1, volume: 1, currency: "USD", sources: ["old"], bronzeIds: [], observations: { old: { open: 1, high: 1, low: 1, close: 1, volume: 1, bronzeId: "x" } } });
    await runDimension(db, price, { trigger: "test", ctx: ctx() });
    const [old] = await db.select().from(silver.priceBars).where(and(eq(silver.priceBars.symbol, "MNRO"), eq(silver.priceBars.date, "2026-09-01")));
    expect(old.sources).toEqual(["old"]);
    const bars = await db.select().from(gold.priceBars).where(eq(gold.priceBars.symbol, "MNRO"));
    expect(bars).toHaveLength(3);
    const [quote] = await db.select().from(gold.quotes).where(eq(gold.quotes.symbol, "MNRO"));
    expect(quote).toMatchObject({ date: "2026-11-03", close: 11.63, previousClose: 12.06, currency: "USD" });
  });
});

describe("entity merge (pure)", () => {
  it("the same entity from two sources is one row with both tags; the trusted source's fields win", () => {
    const merged = mergeSightings(
      new Map(),
      [
        { key: "k", source: "finnhub", bronzeId: "b1", row: { role: null as string | null, price: 1.5 } },
        { key: "k", source: "nasdaq", bronzeId: "b2", row: { role: "Director" as string | null, price: 1.49 } },
      ],
      ["nasdaq", "finnhub"],
    );
    expect(merged.get("k")).toEqual({ role: "Director", price: 1.49, sources: ["nasdaq", "finnhub"], bronzeIds: ["b2", "b1"] });
  });
  it("a source seen again replaces its own sighting, never duplicates its tag", () => {
    const once = mergeSightings(new Map(), [{ key: "k", source: "sec-edgar", bronzeId: "b1", row: { title: "A" } }], ["sec-edgar"]);
    const twice = mergeSightings(once, [{ key: "k", source: "sec-edgar", bronzeId: "b2", row: { title: "B" } }], ["sec-edgar"]);
    expect(twice.get("k")).toEqual({ title: "B", sources: ["sec-edgar"], bronzeIds: ["b2"] });
  });
});

describe("filings dimension", () => {
  it("SEC and TDnet filings land in gold with readable titles and links; a rerun adds no duplicate", async () => {
    await runDimension(db, filingsDimension, { trigger: "test", ctx: ctx() });
    await runDimension(db, filingsDimension, { trigger: "test", ctx: ctx() });
    const mnro = await db.select().from(gold.filings).where(eq(gold.filings.symbol, "MNRO"));
    expect(mnro).toHaveLength(2);
    const eightK = mnro.find((f) => f.form === "8-K")!;
    expect(eightK.title).toBe("Current report: results of operations");
    expect(eightK.url).toBe("https://www.sec.gov/Archives/edgar/data/876427/000087642726000045/mnro-8k.htm");
    expect(eightK.sources).toEqual(["sec-edgar"]);
    const [tdnet] = await db.select().from(gold.filings).where(eq(gold.filings.symbol, "4238.T"));
    expect(tdnet).toMatchObject({ registry: "tdnet", language: "ja", url: "https://www.release.tdnet.info/inbs/140120260908532943.pdf" });
    expect(tdnet.filedAt.toISOString()).toBe("2026-09-08T05:46:00.000Z");
  });

  it("names 8-K items and keeps unknown forms as filed", () => {
    expect(secTitle("8-K", "8-K", "5.02,9.01")).toBe("Current report: officer or director change");
    expect(secTitle("SC TO-T", "Tender offer", "")).toBe("Tender offer");
  });
});

describe("earnings dimension", () => {
  it("a quarter both sources report is one fact per field with both tags; the next report is placed on its quarter", async () => {
    await runDimension(db, earnings, { trigger: "test", ctx: ctx() });
    const rows = await db.select().from(gold.earnings).where(eq(gold.earnings.symbol, "MNRO"));
    const sep = rows.find((r) => r.period === "2026-09")!;
    expect(sep).toMatchObject({ reportDate: "2026-10-29", hour: "bmo", epsActual: -0.01, epsEstimate: 0.05, revenueActual: 283638000 });
    expect(sep.provenance.epsActual.sources.sort()).toEqual(["finnhub", "nasdaq"]);
    expect(sep.provenance.reportDate.sources.sort()).toEqual(["finnhub", "nasdaq"]);
    expect(sep.provenance.revenueActual.sources).toEqual(["finnhub"]);
    const next = rows.find((r) => r.period === "2026-12")!;
    expect(next).toMatchObject({ reportDate: "2027-01-28", epsActual: null, epsEstimate: 0.12 });
  });

  it("adds fiscal quarters across year ends", () => {
    expect(addQuarters("2026-09", 1)).toBe("2026-12");
    expect(addQuarters("2026-12", 1)).toBe("2027-03");
    expect(addQuarters("2026-03", -1)).toBe("2025-12");
  });
});

describe("company-profile new sources", () => {
  it("Nasdaq's sector and market cap reach gold with their tag", async () => {
    await runDimension(db, companyProfile, { trigger: "test", ctx: ctx() });
    const [mnro] = await db.select().from(gold.companyProfiles).where(eq(gold.companyProfiles.symbol, "MNRO"));
    expect(mnro).toMatchObject({ sector: "Consumer Discretionary", industry: "Automotive Aftermarket", marketCap: 364332161 });
    expect(mnro.provenance.sector.sources).toEqual(["nasdaq"]);
  });
});

describe("softenCaps", () => {
  it("turns an all-capitals register name into title case and leaves mixed case alone", async () => {
    const { softenCaps } = await import("./dimensions/company-profile/sources");
    expect(softenCaps("ASHTEAD TECHNOLOGY HOLDINGS PLC")).toBe("Ashtead Technology Holdings Plc");
    expect(softenCaps("KYUNGDONG CITY GAS CO.,LTD")).toBe("Kyungdong City Gas Co.,Ltd");
    expect(softenCaps("Monro, Inc.")).toBe("Monro, Inc.");
  });
});
