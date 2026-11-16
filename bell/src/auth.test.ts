import { test } from "node:test";
import assert from "node:assert/strict";
import { authorized, routeOf } from "./auth.ts";

test("listen needs a WebSocket upgrade, ring a POST; anything else is refused", () => {
  assert.equal(routeOf("GET", "/listen", "websocket"), "listen");
  assert.equal(routeOf("GET", "/listen", null), null);
  assert.equal(routeOf("POST", "/ring", null), "ring");
  assert.equal(routeOf("GET", "/ring", null), null);
  assert.equal(routeOf("POST", "/", null), null);
});

test("the token is required, by Bearer header or ?token=", () => {
  assert.equal(authorized("s3cret", "Bearer s3cret", null), true);
  assert.equal(authorized("s3cret", null, "s3cret"), true);
  assert.equal(authorized("s3cret", "Bearer nope!!", null), false);
  assert.equal(authorized("s3cret", null, null), false);
  assert.equal(authorized(undefined, "Bearer ", ""), false);
});
