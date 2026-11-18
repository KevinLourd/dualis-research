import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { callConsoleTool, positionEdits } from "./console-tools";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

const deps = () => ({ userId: "user_1", read: () => db, write: <T,>(fn: (d: Db) => Promise<T>) => fn(db), dispatch: async () => true });

describe("console acts through the connector", () => {
  it("checks a position's fields like the old form did", () => {
    expect(positionEdits({ direction: "long", entry_date: "2026-03-02", entry_price: 12.5, weight_percent: 20, status: "open" })).toEqual([
      { field: "direction", value: "long" },
      { field: "entryDate", value: "2026-03-02" },
      { field: "entryPrice", value: 12.5 },
      { field: "weight", value: 0.2 },
      { field: "status", value: "open" },
    ]);
    expect(() => positionEdits({ weight_percent: 120 })).toThrow(/100 at most/);
    expect(() => positionEdits({ entry_date: "March 2" })).toThrow(/YYYY-MM-DD/);
  });

  it("refuses an unknown Idea, format or status loudly", async () => {
    await expect(callConsoleTool("draft_idea", { idea_id: "00000000-0000-0000-0000-000000000001", format: "x-post" }, deps())).rejects.toThrow(/not found/);
    await expect(callConsoleTool("draft_idea", { idea_id: "x", format: "tiktok" }, deps())).rejects.toThrow(/format is one of/);
    await expect(callConsoleTool("set_draft_status", { draft_id: "x", status: "published" }, deps())).rejects.toThrow(/status is one of/);
    await expect(callConsoleTool("update_outreach", { handle: "@someone" }, deps())).rejects.toThrow(/status and\/or a message/);
  });

  it("reads Ideas and drafts from gold", async () => {
    expect((await callConsoleTool("list_ideas", {}, deps()))?.text).toBe("No Ideas yet.");
    expect((await callConsoleTool("list_drafts", { status: "approved" }, deps()))?.text).toBe("No drafts.");
  });
});
