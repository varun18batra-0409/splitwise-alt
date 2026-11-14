import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, contextFor, createGroup, joinGroup, openEdit, openSplit, settled } from "../helpers/app";

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
    // Passes in a swipe stack sit side by side: bring each one into view first, the way a person swipes to it.
    await els.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const r = await els.nth(i).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { scroll: el.scrollWidth, client: el.clientWidth, left: b.left, right: b.right, vw: window.innerWidth };
    });
    expect(r.scroll, `${label} #${i} is not clipped`).toBeLessThanOrEqual(r.client + 1);
    expect(r.left, `${label} #${i} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(r.right, `${label} #${i} ends on screen`).toBeLessThanOrEqual(r.vw + 1);
  }
}
// The text a person can actually SEE: the element shows the full text, with nothing cut off sideways or hidden by a line limit
// (toContainText alone also passes for text that is clipped away).
async function textFullyShown(page: Page, selector: string, text: string, label: string) {
  const el = page.locator(selector).filter({ hasText: text }).first();
  await expect(el, `${label}: shows "${text}"`).toBeVisible();
  const r = await el.evaluate((node) => ({
    hiddenAcross: node.scrollWidth > node.clientWidth + 1,
    hiddenDown: node.scrollHeight > node.clientHeight + 1, // a two-line limit hides what does not fit
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    vw: window.innerWidth,
  }));
  expect(r.hiddenAcross, `${label}: nothing cut off sideways`).toBe(false);
  expect(r.hiddenDown, `${label}: nothing hidden by the line limit`).toBe(false);
  expect(r.left, `${label}: starts on screen`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${label}: ends on screen`).toBeLessThanOrEqual(r.vw + 1);
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
  await expect(card).toContainText("₹6,17,283.94"); // Home is exact too
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
  // The paid line may use two lines, but the full amount must be visible, not clipped with "…".
  await textFullyShown(page, 'li[id^="item-"] [data-paid-line]', "₹12,34,567.88", "Activity paid line");
  await fullyVisible(page, 'li[id^="item-"] span.font-semibold[data-exact]', "Activity amount");
  const paid = await row.locator("[data-paid-line]").first().evaluate((el) => el.getBoundingClientRect().right);
  const effect = await row.locator("span.font-semibold[data-exact]").first().evaluate((el) => el.getBoundingClientRect().left);
  expect(paid, "the paid line stops before the amount column").toBeLessThanOrEqual(effect + 1);
  expect(await noSidewaysScroll(page), "Activity does not scroll sideways").toBeLessThanOrEqual(1);

  // Edit the big expense once (add a note): the row now says "paid ₹12,34,567.88 · edited". Both the full amount and "edited" stay
  // visible (two lines allowed), nothing runs under the amount column, nothing scrolls sideways.
  await openEdit(page, g1.path, "Villa");
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.getByPlaceholder("e.g. Rahul paid the tip separately").fill("Booked by phone");
  await openSplit(page);
  await page.getByRole("button", { name: "Everyone equally" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/tab=activity/);
  await settled(page);
  const edited = page.locator('li[id^="item-"]').filter({ hasText: "Villa" }).first();
  await expect(edited.locator("[data-paid-line]").first()).toContainText("edited");
  await textFullyShown(page, 'li[id^="item-"] [data-paid-line]', "₹12,34,567.88", "Edited paid line (amount)");
  await textFullyShown(page, 'li[id^="item-"] [data-paid-line]', "edited", "Edited paid line (edited)");
  await fullyVisible(page, 'li[id^="item-"] span.font-semibold[data-exact]', "Edited row amount");
  const paid2 = await edited.locator("[data-paid-line]").first().evaluate((el) => el.getBoundingClientRect().right);
  const effect2 = await edited.locator("span.font-semibold[data-exact]").first().evaluate((el) => el.getBoundingClientRect().left);
  expect(paid2, "the edited paid line stops before the amount column").toBeLessThanOrEqual(effect2 + 1);
  expect(await noSidewaysScroll(page), "the edited row does not scroll sideways").toBeLessThanOrEqual(1);

  // A three-person group with paise: Asha pays ₹18,51,851.82, each of the three owes ₹6,17,283.94 (1851851.82 / 3, worked by hand),
  // so the two others owe Asha ₹12,34,567.88. Smart Settle works from each person's net, so one person is never both a payer and a
  // payee in the same group: this is the one-sided ticket (the two-sided one is Home's, above). Its amounts are exact and
  // fully visible at 320.
  const g3 = await createGroup(A, groupName("Big three"));
  await joinGroup(B, g3.invite, g3.path);
  await joinGroup(C, g3.invite, g3.path);
  await addEqualExpense(A, g3.path, "Resort", "1851851.82");
  await page.goto(g3.path);
  await settled(page);
  await expect(page.locator("[data-group-balance] [data-net-balance]").first()).toContainText("₹12,34,567.88");
  await fullyVisible(page, "[data-group-balance] [data-net-balance]", "Three-person ticket amount");
  await expect(page.locator("[data-group-balance]")).toHaveAttribute("data-ticket", "one");
  expect(await noSidewaysScroll(page), "the three-person group does not scroll sideways").toBeLessThanOrEqual(1);
  await page.goto(`${g3.path}?tab=balances`);
  await settled(page);
  await expect(page.locator("details.group\\/person > summary").filter({ hasText: "Bina" })).toContainText("owes ₹6,17,283.94");
  expect(await noSidewaysScroll(page), "Balances does not scroll sideways").toBeLessThanOrEqual(1);
  await ctx.close();
});
