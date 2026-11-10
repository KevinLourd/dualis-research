import { describe, expect, it } from "vitest";
import { isAuthorized } from "./site-gate";

const basic = (s: string) => "Basic " + btoa(s);

describe("preview gate", () => {
  it("opens with the right user and password", () => {
    expect(isAuthorized(basic("dualis:secret"), "secret")).toBe(true);
  });
  it("stays closed without a header, a wrong password or a wrong user", () => {
    expect(isAuthorized(null, "secret")).toBe(false);
    expect(isAuthorized(basic("dualis:nope"), "secret")).toBe(false);
    expect(isAuthorized(basic("admin:secret"), "secret")).toBe(false);
    expect(isAuthorized("Bearer x", "secret")).toBe(false);
    expect(isAuthorized("Basic %%%", "secret")).toBe(false);
  });
  it("refuses to run without a configured password", () => {
    expect(() => isAuthorized(basic("dualis:"), "")).toThrow(/SITE_PASSWORD/);
  });
});
