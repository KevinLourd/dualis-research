import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SANDBOX_ACCOUNTS } from "@/collectors/dimensions/sandbox-accounts";
import { hasLogo, logoSvg } from "./sandbox-logos";

describe("sandbox logos", () => {
  it("every Sandbox account has a logo, transparent for the avatar, on its colour for the download", () => {
    for (const a of SANDBOX_ACCOUNTS) {
      expect(hasLogo(a.handle)).toBe(true);
      expect(logoSvg(a.handle, { size: 40 })).not.toContain("<rect width=\"100\"");
      expect(logoSvg(a.handle, { size: 400, background: a.avatarColor })).toContain(`fill="${a.avatarColor}"`);
    }
    expect(() => logoSvg("nobody", { size: 40 })).toThrow(/no logo/);
    // Layout check only (never shown as a report): LOGOS_HTML=<path> writes the three logos at their sizes.
    if (process.env.LOGOS_HTML) {
      const xs = SANDBOX_ACCOUNTS.filter((a) => a.platform === "x");
      const cell = (a: (typeof xs)[number], size: number, round: boolean) =>
        `<span style="display:inline-flex;width:${size}px;height:${size}px;border-radius:${round ? "50%" : "22%"};background:${a.avatarColor};overflow:hidden;margin:12px">${logoSvg(a.handle, { size })}</span>`;
      writeFileSync(process.env.LOGOS_HTML, `<html><body style="background:#fff">${xs.map((a) => `<div>${cell(a, 133, true)}${cell(a, 40, true)}${cell(a, 80, false)}${logoSvg(a.handle, { size: 133, background: a.avatarColor })}</div>`).join("")}</body></html>`);
    }
  });
});
