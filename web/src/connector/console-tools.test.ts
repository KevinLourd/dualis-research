import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { callConsoleTool } from "./console-tools";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

const deps = () => ({ userId: "user_1", write: <T,>(fn: (d: Db) => Promise<T>) => fn(db) });

describe("console acts through the connector", () => {
  it("refuses an outreach change with nothing in it", async () => {
    await expect(callConsoleTool("update_outreach", { handle: "@someone" }, deps())).rejects.toThrow(/status and\/or a message/);
  });

});
