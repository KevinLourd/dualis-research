import { describe, expect, it } from "vitest";
import { signalAlert } from "./messages";
import { gapOf, positionReturn, signalWords, tagWord } from "./signal-words";

describe("signal words (Thierry's terms)", () => {
  it("a BUY is an inflection, a SELL a crack", () => {
    expect(signalWords("BUY", "strong")).toBe("BUY (strong inflection)");
    expect(signalWords("SELL", "weak")).toBe("SELL (weak crack)");
    expect(signalWords("none", "noise")).toBe("no signal");
  });

  it("the gap is price vs HIS fair value, above or below, and nothing without his number", () => {
    expect(gapOf(17.4, 24)).toEqual({ pct: expect.closeTo(0.275, 3), side: "below" });
    expect(gapOf(30, 24)).toEqual({ pct: expect.closeTo(0.25, 3), side: "above" });
    expect(gapOf(17.4, null)).toBeNull();
    expect(gapOf(null, 24)).toBeNull();
  });

  it("the WhatsApp signal is the Signal Change: the new signal, its Update Note, the why page", () => {
    const text = signalAlert({ symbol: "4238.T", fromSignal: "none", fromStrength: "noise", toSignal: "BUY", toStrength: "strong", updateNote: "Orders turn up." }, "Miraial");
    expect(text.split("\n")).toEqual(["*4238.T* (Miraial): BUY (strong inflection), was no signal.", "Orders turn up.", expect.stringMatching(/^Why: https:\/\/.+\/tickers\/4238\.T$/)]);
  });
});

describe("position return", () => {

  it("a short's return flips sign; no entry price, no return", () => {
    expect(positionReturn(100, 120, "long")).toBeCloseTo(0.2);
    expect(positionReturn(100, 120, "short")).toBeCloseTo(-0.2);
    expect(positionReturn(null, 120, "long")).toBeNull();
    expect(positionReturn(100, 120, null)).toBeNull();
  });
});

describe("tagWord", () => {
  it("a reversal reads Inflection on the long thesis, Crack on the short one", () => {
    expect(tagWord("reversal", "strong", "long")).toBe("Strong inflection");
    expect(tagWord("reversal", "weak", "short")).toBe("Weak crack");
    expect(tagWord("continuation", "strong", "long")).toBe("Strong continuation");
    expect(tagWord("noise", "noise", "short")).toBe("Noise");
  });
});
