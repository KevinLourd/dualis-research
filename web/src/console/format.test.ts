import { describe, expect, it } from "vitest";
import { dateFormat, day, numberFormat, price, signedCount } from "./format";

describe("cached formatters (Workers CPU, 2026-11-17)", () => {
  it("builds one formatter per option set", () => {
    expect(numberFormat({ maximumFractionDigits: 2 })).toBe(numberFormat({ maximumFractionDigits: 2 }));
    expect(numberFormat({ maximumFractionDigits: 2 })).not.toBe(numberFormat({ maximumFractionDigits: 1 }));
    expect(dateFormat("en-GB", { month: "short" })).toBe(dateFormat("en-GB", { month: "short" }));
    expect(dateFormat("en-GB", { month: "short" })).not.toBe(dateFormat("en-US", { month: "short" }));
  });
  it("prints what the console printed before", () => {
    expect(day("2026-11-04")).toBe("4 Nov 2026");
    expect(day(new Date("2026-01-09T23:00:00Z"))).toBe("9 Jan 2026");
    expect(price(1453.2)).toBe("1,453");
    expect(price(10.28, "USD")).toBe("10.28 USD");
    expect(price(0.12345)).toBe("0.1235");
    expect(signedCount(11149)).toBe("+11,149");
    expect(signedCount(-6667)).toBe("-6,667");
  });
});
