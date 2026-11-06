import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

/**
 * Node only (loaded by URL from the dimension). A screenshot of the news page an Idea cites, 1280 x 720, through the
 * Chrome already on the machine (GitHub's Ubuntu runners ship it; `CHROME_PATH` overrides): no browser download.
 */
const CHROMES = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
/** Consent buttons worth one click before the shot (most news sites open on one). */
const CONSENT = /^(accept all|accept|i agree|agree|got it|allow all|ok)$/i;

export function chromePath(env: Record<string, string | undefined> = process.env): string {
  const found = [env.CHROME_PATH, ...CHROMES].find((p): p is string => !!p && existsSync(p));
  if (!found) throw new Error(`no Chrome found (set CHROME_PATH; looked in ${CHROMES.join(", ")})`);
  return found;
}

export async function capture(url: string): Promise<{ file: Buffer; finalUrl: string }> {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (res && res.status() >= 400) throw new Error(`${new URL(page.url()).hostname} answered ${res.status()}`);
    await page.waitForTimeout(3000);
    const consent = page.getByRole("button", { name: CONSENT });
    if ((await consent.count()) > 0 && (await consent.first().isVisible())) {
      await consent.first().click({ timeout: 2000 });
      await page.waitForTimeout(800);
    }
    const file = await page.screenshot({ type: "jpeg", quality: 80 });
    return { file: Buffer.from(file), finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}
