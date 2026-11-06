import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quotes } from "@/db/schema/gold";
import { theses } from "@/db/schema/thesis";
import type { Db } from "@/db/types";
import { analyseEveryTicker, testDb } from "@/test/db";
import { thesis } from "./dimensions/thesis";
import { recordConsoleEdit } from "./dimensions/thesis/console";
import { parseResearch, RESEARCH_SYSTEM } from "./dimensions/thesis/research";
import { watchlist } from "./dimensions/watchlist";
import { runDimension } from "./runner";
import type { SourceContext } from "./types";

const REPO_ROOT = resolve(__dirname, "../../..");

/** Claude, faked: the narrative and the view for any ticker, with the em dash it is told never to write. */
const fakeComplete = () =>
  vi.fn(async ({ prompt }: { system: string; prompt: string }) => {
    const symbol = /^Stock: ([^\s,]+)/.exec(prompt)![1];
    return {
      text: JSON.stringify({ narrative: `Investors see ${symbol} as a dying business — sales fall.`, summary: `New contracts show ${symbol} is growing again.` }),
      model: "fake",
    };
  });

let complete = fakeComplete();
const noFetch = (async () => {
  throw new Error("no network in this test");
}) as typeof fetch;
const ctxWith = () => ({ env: { REPO_ROOT, CLAUDE_OAUTH_TOKEN: "t" }, fetch: noFetch, complete }) as SourceContext;

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  complete = fakeComplete();
  ({ db, close } = await testDb());
  await runDimension(db, watchlist, { trigger: "test", ctx: { env: { REPO_ROOT }, fetch: noFetch } as SourceContext });
  await analyseEveryTicker(db);
  await db.insert(quotes).values({ symbol: "MNRO", date: "2026-11-03", close: 17.4, currency: "USD", sources: ["nasdaq"] });
});
afterEach(async () => close());

describe("thesis dimension: narrative + view, no AI number", () => {
  it("drafts every ticker once: the market's narrative and the view, dashes cleaned, nothing else", async () => {
    const report = await runDimension(db, thesis, { trigger: "test", ctx: ctxWith() });
    expect(report.status).toBe("succeeded");
    const [t] = await db.select().from(theses).where(eq(theses.symbol, "MNRO"));
    expect(t).toMatchObject({
      narrative: "Investors see MNRO as a dying business, sales fall.",
      narrativeState: "draft",
      summary: "New contracts show MNRO is growing again.",
      summaryState: "draft",
      fairValue: null,
    });
    const calls = complete.mock.calls.length;
    expect(calls).toBeGreaterThan(30);
    await runDimension(db, thesis, { trigger: "test", ctx: ctxWith() });
    expect(complete.mock.calls.length).toBe(calls); // drafted once
  });

  it("Thierry's edit and fair value win; Claude never writes a fair value", async () => {
    await runDimension(db, thesis, { trigger: "test", ctx: ctxWith() });
    await recordConsoleEdit(db, "MNRO", { field: "narrative", value: "The market thinks tires are a commodity.", action: "edit", userId: "u1" });
    await recordConsoleEdit(db, "MNRO", { field: "fairValue", value: { value: 24, currency: "USD", basis: "8x EV/EBITDA" }, action: "edit", userId: "u1" });
    const [t] = await db.select().from(theses).where(eq(theses.symbol, "MNRO"));
    expect(t).toMatchObject({ narrative: "The market thinks tires are a commodity.", narrativeState: "edited", fairValue: 24, fairValueBasis: "8x EV/EBITDA", currency: "USD" });
    const [other] = await db.select().from(theses).where(eq(theses.symbol, "BOOT"));
    expect(other.fairValue).toBeNull();
  });

  it("the prompt forbids computed numbers and the parser needs both sentences", () => {
    expect(RESEARCH_SYSTEM).toContain("Never a number you computed");
    expect(() => parseResearch(JSON.stringify({ narrative: "x" }))).toThrow(/summary/);
    expect(parseResearch('```json\n{"narrative": "a", "summary": "b"}\n```')).toEqual({ narrative: "a", summary: "b" });
  });
});
