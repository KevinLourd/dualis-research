import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dispatchBody, dispatchFor, OWN_WORKFLOW, SCHEDULE } from "./plan.ts";

test("each slot starts collect.yml on main with its dimension, marked as a scheduled run", () => {
  assert.deepEqual(dispatchBody("0 2 * * *"), {
    ref: "main",
    inputs: { dimension: "growth-outreach,substack-network,growth-brief", trigger: "schedule" },
  });
  assert.equal(dispatchBody("15 5 * * *").inputs.dimension, "all");
  assert.equal(dispatchBody("15 1,9,13,17,21 * * *").inputs.dimension, "core");
});

test("an unknown cron fails loud", () => {
  assert.throws(() => dispatchBody("0 3 * * *"), /Unknown cron/);
});

test("wrangler.jsonc declares exactly the crons the schedule knows", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]) as string[];
  assert.deepEqual([...crons].sort(), [...Object.keys(SCHEDULE), ...Object.keys(OWN_WORKFLOW)].sort());
});

test("the hourly X slot starts x-publish.yml on main, every other slot collect.yml", () => {
  assert.deepEqual(dispatchFor("10 3-16 * * *"), { workflow: "x-publish.yml", body: { ref: "main" } });
  assert.equal(dispatchFor("15 5 * * *").workflow, "collect.yml");
  assert.throws(() => dispatchFor("0 3 * * *"), /Unknown cron/);
});
