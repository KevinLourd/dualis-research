import { describe, expect, it } from "vitest";
import { isUpgrade, sideOfSignal } from "./signal-alert";

const step = (from: string, to: string) => {
  const [fromSignal, fromStrength] = from.split(" ");
  const [toSignal, toStrength] = to.split(" ");
  return { fromSignal, fromStrength, toSignal, toStrength };
};

describe("isUpgrade (Thierry 2026-11-11: alert only on a really strong signal)", () => {
  it.each([
    ["none noise", "SELL strong"],
    ["none noise", "BUY strong"],
    ["BUY weak", "BUY strong"],
    ["SELL weak", "SELL strong"],
    ["BUY strong", "SELL strong"],
    ["SELL weak", "BUY strong"],
  ])("%s -> %s alerts", (from, to) => expect(isUpgrade(step(from, to))).toBe(true));

  it.each([
    ["none noise", "BUY weak"],
    ["SELL strong", "BUY weak"],
    ["BUY weak", "SELL weak"],
    ["BUY strong", "BUY strong"],
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
