import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portfolioPositions } from "@/db/schema/portfolio";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { portfolio, recordPositionEdit } from "./dimensions/portfolio";
import { BENCHMARK } from "./benchmark";
import { price } from "./dimensions/price";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");
const noFetch = (async () => {
  throw new Error("no network in this test");
}) as typeof fetch;
const ctx = { env: { REPO_ROOT }, fetch: noFetch } as SourceContext;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx });
});
afterEach(async () => close());

describe("portfolio dimension", () => {
  it("one gold row per portfolio ticker; only what his posts state, each value with its cite; nothing guessed", async () => {
    const report = await runDimension(db, portfolio, { trigger: "test", ctx });
    expect(report.status).toBe("succeeded");
    const rows = await db.select().from(portfolioPositions);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["101160.KQ", "1161.HK", "4238.T", "SPCB"]);
    const wo = rows.find((r) => r.symbol === "1161.HK")!;
    expect(wo).toMatchObject({ direction: "long", status: "open", reportedReturn: -0.05, reportedReturnAsOf: "2026-10-16", entryPrice: null, entryDate: null });
    expect(wo.provenance.status.cite?.quote).toBe("Water Oasis Limited (1161-HK) Open: -5% return");
    const spcb = rows.find((r) => r.symbol === "SPCB")!;
    expect(spcb).toMatchObject({ direction: null, entryPrice: null, status: null });
  });

  it("Thierry's console edit wins over his post and keeps the post's value in silver", async () => {
    await runDimension(db, portfolio, { trigger: "test", ctx });
    await recordPositionEdit(db, "1161.HK", { field: "entryPrice", value: 1.12, userId: "u" });
    await recordPositionEdit(db, "1161.HK", { field: "direction", value: "short", userId: "u" });
    const [wo] = await db.select().from(portfolioPositions).where(eq(portfolioPositions.symbol, "1161.HK"));
    expect(wo).toMatchObject({ entryPrice: 1.12, direction: "short", status: "open" });
    expect(wo.provenance.direction).toEqual({ sources: ["console"], cite: null });
    // A later post run does not overwrite his word.
    await runDimension(db, portfolio, { trigger: "test", ctx });
    const [again] = await db.select().from(portfolioPositions).where(eq(portfolioPositions.symbol, "1161.HK"));
    expect(again.direction).toBe("short");
  });

  it("the price dimension also fetches the S&P 500 benchmark, from Yahoo only", async () => {
    const subjects = await price.subjects(db, ctx);
    expect(subjects).toContain(BENCHMARK);
    expect(price.sources.filter((s) => s.covers(BENCHMARK)).map((s) => s.name)).toEqual(["yahoo"]);
  });
});
