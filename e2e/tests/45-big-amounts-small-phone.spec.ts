import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// A lakh-sized amount on a 320 × 640 phone: nothing scrolls sideways, nothing is clipped, and the amount is always fully visible.
// ₹12,34,567.88 shared by two is ₹6,17,283.94 each (1234567.88 / 2 = 617283.94, worked by hand).
const W = 320;
const H = 640;

// The element's own text fits (scrollWidth <= clientWidth) and sits fully inside the screen.
async function fullyVisible(page: Page, selector: string, label: string) {
  const els = page.locator(selector);
  const n = await els.count();
  expect(n, `${label}: found`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const r = await els.nth(i).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { scroll: el.scrollWidth, client: el.clientWidth, left: b.left, right: b.right, vw: window.innerWidth };
    });
    expect(r.scroll, `${label} #${i} is not clipped`).toBeLessThanOrEqual(r.client + 1);
    expect(r.left, `${label} #${i} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(r.right, `${label} #${i} ends on screen`).toBeLessThanOrEqual(r.vw + 1);
  }
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("a lakh amount fits at 320×640: the activity row and Home's two-sided ticket", async ({ browser }) => {
  test.setTimeout(180_000);
  const asha = await signUp("Asha", testEmail("big-asha"));
  const bina = await signUp("Bina", testEmail("big-bina"));
  const cara = await signUp("Cara", testEmail("big-cara"));
  const [A, B, C] = [await (await contextFor(browser, asha)).newPage(), await (await contextFor(browser, bina)).newPage(), await (await contextFor(browser, cara)).newPage()];
  // Group 1: Asha pays, so Bina owes her. Group 2: Cara pays, so Asha owes Cara. That makes Home's ticket two-sided.
  const g1 = await createGroup(A, groupName("Big one"));
  await joinGroup(B, g1.invite, g1.path);
  await addEqualExpense(A, g1.path, "Villa", "1234567.88");
  const g2 = await createGroup(A, groupName("Big two"));
  await joinGroup(C, g2.invite, g2.path);
  await addEqualExpense(C, g2.path, "Boat", "1234567.88");

  const ctx = await browser.newContext({ storageState: asha.storageState, viewport: { width: W, height: H } });
  await allowTestCopy(ctx);
  const page = await ctx.newPage();

  // Home: the card says "both", each line's amount is whole and fully visible.
  await page.goto("/");
  await settled(page);
  const card = page.locator("[data-balance-card]").first();
  await expect(card).toHaveAttribute("data-ticket", "both");
  await expect(card).toContainText("₹6,17,284"); // Home rounds to whole rupees
  await fullyVisible(page, "[data-balance-card] [data-net-balance]", "Home ticket amount");
  expect(await noSidewaysScroll(page), "Home does not scroll sideways").toBeLessThanOrEqual(1);

  // The group's own ticket: exact, and fully visible.
  await page.goto(g1.path);
  await settled(page);
  await expect(page.locator("[data-group-balance] [data-net-balance]").first()).toContainText("₹6,17,283.94");
  await fullyVisible(page, "[data-group-balance] [data-net-balance]", "Group ticket amount");
  expect(await noSidewaysScroll(page), "the group page does not scroll sideways").toBeLessThanOrEqual(1);

  // The activity row: exact amounts; "paid … · edited" shrinks and never runs under the amount on the right.
  await page.goto(`${g1.path}?tab=activity`);
  await settled(page);
  const row = page.locator('li[id^="item-"]').filter({ hasText: "Villa" }).first();
  await expect(row).toContainText("₹12,34,567.88");
  await fullyVisible(page, 'li[id^="item-"] span.font-semibold[data-exact]', "Activity amount");
  const paid = await row.locator("[data-paid-line]").first().evaluate((el) => el.getBoundingClientRect().right);
  const effect = await row.locator("span.font-semibold[data-exact]").first().evaluate((el) => el.getBoundingClientRect().left);
  expect(paid, "the paid line stops before the amount column").toBeLessThanOrEqual(effect + 1);
  expect(await noSidewaysScroll(page), "Activity does not scroll sideways").toBeLessThanOrEqual(1);
  await ctx.close();
});
