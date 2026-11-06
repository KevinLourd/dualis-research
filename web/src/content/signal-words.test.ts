import { describe, expect, it } from "vitest";
import { alertMessage } from "./messages";
import { evidenceStrength, gapOf, positionReturn, signalHeadline, stateWord, tagWord } from "./signal-words";

describe("signal words (Thierry's terms)", () => {
  it("a cracking story reads inflecting on a long, cracking on a short or a watched name", () => {
    expect(stateWord("cracking", "long")).toBe("Inflecting");
    expect(stateWord("cracking", "short")).toBe("Cracking");
    expect(stateWord("cracking", "watch")).toBe("Cracking");
    expect(stateWord("holds", "long")).toBe("Holds");
    expect(signalHeadline("PAL", "holds", "short")).toBe("*PAL*: the narrative holds again.");
  });

  it("the gap is price vs HIS fair value, above or below, and nothing without his number", () => {
    expect(gapOf(17.4, 24)).toEqual({ pct: expect.closeTo(0.275, 3), side: "below" });
    expect(gapOf(30, 24)).toEqual({ pct: expect.closeTo(0.25, 3), side: "above" });
    expect(gapOf(17.4, null)).toBeNull();
    expect(gapOf(null, 24)).toBeNull();
  });

  it("the WhatsApp signal says the turn, why, the evidence and links the why page", () => {
    const text = alertMessage({ id: "x", symbol: "4238.T", fromState: "holds", toState: "cracking", reason: "Orders turn.", citedEvidence: "Orders rose 12%." }, "long");
    expect(text.split("\n")).toEqual([
      "*4238.T*: the narrative is inflecting.",
      "Orders turn.",
      "Evidence: Orders rose 12%.",
      expect.stringMatching(/^Why: https:\/\/.+\/tickers\/4238\.T$/),
    ]);
  });
});

describe("evidence strength, position return", () => {
  it("a contradicting news is Strong from 0.7, Weak below; a continuing one is Noise", () => {
    expect(evidenceStrength("contradicts", 0.8)).toBe("strong");
    expect(evidenceStrength("contradicts", 0.5)).toBe("weak");
    expect(evidenceStrength("continues", 0.9)).toBe("noise");
  });

  it("a short's return flips sign; no entry price, no return", () => {
    expect(positionReturn(100, 120, "long")).toBeCloseTo(0.2);
    expect(positionReturn(100, 120, "short")).toBeCloseTo(-0.2);
    expect(positionReturn(null, 120, "long")).toBeNull();
    expect(positionReturn(100, 120, null)).toBeNull();
  });
});

describe("tagWord", () => {
  it("a reversal reads Inflection below fair value, Crack above", () => {
    expect(tagWord("reversal", "strong", -0.14)).toBe("Strong inflection");
    expect(tagWord("reversal", "weak", 0.2)).toBe("Weak crack");
    expect(tagWord("continuation", "strong", -0.1)).toBe("Strong continuation");
    expect(tagWord("noise", "noise", 0.1)).toBe("Noise");
  });
});
