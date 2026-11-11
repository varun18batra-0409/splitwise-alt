import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Add expense's Faster entry row on small phones: icon above the label, nothing cut off, buttons at least 48px tall.
// Also: the several-payers row is one 44px tap target that includes its words.
for (const [w, h] of [
  [320, 568],
  [375, 667],
] as const) {
  test(`Faster entry buttons fit at ${w}×${h}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const asha = await signUp("Asha", testEmail(`fast-asha-${w}`));
    const ravi = await signUp("Ravi", testEmail(`fast-ravi-${w}`));
    const A = await (await contextFor(browser, asha)).newPage();
    const R = await (await contextFor(browser, ravi)).newPage();
    const g = await createGroup(A, groupName(`Fast ${w}`), "Trip");
    await joinGroup(R, g.invite, g.path);

    const ctx = await browser.newContext({ storageState: asha.storageState, viewport: { width: w, height: h } });
    await allowTestCopy(ctx);
    const page = await ctx.newPage();
    await page.goto(`${g.path}/add`);
    await settled(page);
    const buttons = page.getByRole("group", { name: "Faster entry" }).getByRole("button");
    expect(await buttons.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      const m = await b.evaluate((el) => {
        const label = el.querySelector("span") as HTMLElement;
        return { sw: el.scrollWidth, cw: el.clientWidth, lw: label.scrollWidth, lcw: label.clientWidth, lsh: label.scrollHeight, lch: label.clientHeight, h: el.getBoundingClientRect().height };
      });
      expect(m.sw, `button ${i} width`).toBeLessThanOrEqual(m.cw);
      expect(m.lw, `label ${i} width`).toBeLessThanOrEqual(m.lcw);
      expect(m.lsh, `label ${i} height (2 lines at most)`).toBeLessThanOrEqual(m.lch + 1);
      expect(m.h, `button ${i} height`).toBeGreaterThanOrEqual(48);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    // Several payers: tapping the words flips the switch; the row is 44px tall.
    await page.locator("[data-more] > button").click();
    const row = page.locator("[data-multi-pay-row]");
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const sw = page.getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await row.getByText("More than one person paid").click();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    // A several-payers error opens More by itself even when it was closed.
    await page.locator("[data-more] > button").click(); // close More
    await page.locator("#expense-name").fill("Dinner");
    await page.getByLabel("Amount", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page.locator("[data-more] > button")).toHaveAttribute("aria-expanded", "true");
    await ctx.close();
  });
}
