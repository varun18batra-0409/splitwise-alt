import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Add expense's faster-entry icons on small phones: inside the name field, nothing cut off, buttons at least 44px tall.
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
    // The three faster ways in are small icon buttons inside the "What was it?" field: each at least 44px tall,
    // all inside the field, and the name box still has room to type in.
    const buttons = page.getByRole("group", { name: "Faster entry" }).getByRole("button");
    expect(await buttons.count()).toBeGreaterThanOrEqual(3);
    const field = (await page.locator("#expense-name").evaluate((el) => el.parentElement!.getBoundingClientRect().toJSON())) as { left: number; right: number };
    for (let i = 0; i < (await buttons.count()); i++) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(36);
      expect(box.x, `button ${i} inside the field (left)`).toBeGreaterThanOrEqual(field.left);
      expect(box.x + box.width, `button ${i} inside the field (right)`).toBeLessThanOrEqual(field.right + 1);
      expect(await buttons.nth(i).getAttribute("aria-label"), `button ${i} has a name`).toBeTruthy();
    }
    expect((await page.locator("#expense-name").boundingBox())!.width, "room left to type the name").toBeGreaterThanOrEqual(80);
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
