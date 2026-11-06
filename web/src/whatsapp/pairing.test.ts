import { describe, expect, it } from "vitest";
import { formatPairingCode, pairingDue, pairingPhone } from "./pairing";

describe("link with a code", () => {
  it("keeps the digits of a number typed with its country code, refuses a short one", () => {
    expect(pairingPhone("+7 (701) 000-0000")).toBe("77010000000");
    expect(() => pairingPhone("12345")).toThrow(/country code/);
  });

  it("asks WhatsApp once per request and connection, never for a stale request", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const row = { pairingPhone: "77010000000", pairingRequestedAt: new Date(now - 60_000) };
    const conn = {};
    expect(pairingDue(row, null, conn, now)).toBe(true);
    const answered = { requestedAt: row.pairingRequestedAt.getTime(), connection: conn };
    expect(pairingDue(row, answered, conn, now)).toBe(false);
    // A new connection (the old code died with the old one) asks again.
    expect(pairingDue(row, answered, {}, now)).toBe(true);
    // A new request on the same connection asks again.
    expect(pairingDue({ ...row, pairingRequestedAt: new Date(now) }, answered, conn, now)).toBe(true);
    expect(pairingDue({ ...row, pairingRequestedAt: new Date(now - 11 * 60_000) }, null, conn, now)).toBe(false);
    expect(pairingDue({ pairingPhone: null, pairingRequestedAt: null }, null, conn, now)).toBe(false);
  });

  it("shows the code the way WhatsApp does", () => {
    expect(formatPairingCode("ABCD1234")).toBe("ABCD-1234");
  });
});
