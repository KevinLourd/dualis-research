import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { testDb } from "@/test/db";
import { memo } from "./markets";
import { runDimension } from "./runner";
import type { Dimension } from "./types";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await testDb()));
afterEach(async () => close());

describe("runner", () => {
  it("hands every subject the same context, so a per-run memo loads once", async () => {
    let loads = 0;
    const dim: Dimension = {
      name: "memo-test",
      description: "",
      sources: [
        {
          name: "s",
          requiredEnv: [],
          covers: () => true,
          fetch: async (subject, ctx) => {
            const map = await memo(ctx, "shared", async () => (loads++, { ok: true }));
            return { request: { subject }, httpStatus: 200, payload: map };
          },
        },
      ],
      subjects: async () => ["a", "b", "c"],
      promote: async () => ({ silverRowsBySource: {} }),
    };
    const report = await runDimension(db, dim, { trigger: "test", ctx: { env: {}, fetch } });
    expect(report.status).toBe("succeeded");
    expect(loads).toBe(1);
  });
});
