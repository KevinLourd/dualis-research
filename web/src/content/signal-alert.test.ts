import { describe, expect, it } from "vitest";
import { isUpgrade, sideOfSignal } from "./signal-alert";

const step = (from: string, to: string) => {
  const [fromSignal, fromStrength] = from.split(" ");
  const [toSignal, toStrength] = to.split(" ");
  return { fromSignal, fromStrength, toSignal, toStrength };
};

describe("isUpgrade (Kevin 2026-11-09: alert only when the signal gets better)", () => {
  it.each([
    ["none noise", "BUY weak"],
    ["none noise", "SELL strong"],
    ["BUY weak", "BUY strong"],
    ["SELL weak", "SELL strong"],
    ["BUY strong", "SELL strong"],
    ["SELL strong", "BUY weak"],
    ["BUY weak", "SELL weak"],
  ])("%s -> %s alerts", (from, to) => expect(isUpgrade(step(from, to))).toBe(true));

  it.each([
    ["BUY strong", "BUY weak"],
    ["SELL weak", "none noise"],
    ["BUY strong", "none noise"],
    ["none noise", "none noise"],
  ])("%s -> %s stays silent", (from, to) => expect(isUpgrade(step(from, to))).toBe(false));
});

describe("sideOfSignal", () => {
  it("BUY is the long thesis, SELL the short one", () => {
    expect(sideOfSignal("BUY")).toBe("long");
    expect(sideOfSignal("SELL")).toBe("short");
    expect(() => sideOfSignal("none")).toThrow();
  });
});
