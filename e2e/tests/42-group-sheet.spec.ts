import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, settled } from "../helpers/app";

// The one-time sheet after making a flat (src/components/GroupTypeSheet.tsx): two cards, shown once on this phone.
test("a new flat shows its two-card sheet once, and “Got it” hides it for good", async ({ browser }) => {
  test.setTimeout(120_000);
  const asha = await signUp("Asha", testEmail("sheet-asha"));
  const ctx = await contextFor(browser, asha);
  const page = await ctx.newPage();
  const g = await createGroup(page, groupName("Sheet flat"), "Home");

  // Test browsers keep the sheet switched off; this one turns it back on, like a real phone.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("lp-type-sheet-off");
    } catch {
      /* storage blocked */
    }
  });
  await page.goto(g.path);
  await settled(page);
  const sheet = page.getByRole("dialog", { name: "Your flat is ready" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Bills that repeat")).toBeVisible();
  await expect(sheet.getByText("Moving in or out")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Add the first bill" })).toBeVisible();

  // Focus moves into the sheet, and Tab (either way) stays inside it.
  const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
  expect(await inside()).toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }

  await sheet.getByRole("button", { name: "Got it" }).click();
  await expect(sheet).toHaveCount(0);

  // Shown once: not on a reload, and not on the next visit.
  await page.reload();
  await settled(page);
  await expect(page.getByRole("dialog", { name: "Your flat is ready" })).toHaveCount(0);
  await page.goto(g.path);
  await settled(page);
  await expect(page.getByRole("dialog", { name: "Your flat is ready" })).toHaveCount(0);
  await ctx.close();
});
