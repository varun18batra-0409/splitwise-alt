import { test, expect } from "../fixtures";
import { allowTestCopy } from "../helpers/app";

// Sign-in on small phones: Google (when it's switched on) and the email box are both on the first
// screen, with no scrolling, at 320×568 and 375×667. No sideways scroll either.
for (const [w, h] of [
  [320, 568],
  [375, 667],
] as const) {
  test(`sign-in fits the first screen at ${w}×${h}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await allowTestCopy(ctx);
    const page = await ctx.newPage();
    await page.goto("/signin");
    const email = page.locator('input[name="email"]');
    await expect(email).toBeVisible();
    const box = (await email.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(h);
    const google = page.locator('a[href^="/api/auth/google/start"]');
    if (await google.count()) {
      const g = (await google.boundingBox())!;
      expect(g.y + g.height).toBeLessThanOrEqual(h);
      expect(g.y).toBeLessThan(box.y); // Google first, then the email box
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await ctx.close();
  });
}
