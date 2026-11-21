import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, createGroup, joinGroup, settled } from "../helpers/app";

// Accessibility follow-up (one-off check, 19 Nov): with text at 200% a trip group page must not scroll sideways on a 390 px phone
// (the faces and the Invite pill used to push it to 444 px), and every screen has exactly one main heading (Home had none, the tour had seven).
const phone = { width: 390, height: 844 };
const bigText = (page: import("@playwright/test").Page) => page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
const h1s = (page: import("@playwright/test").Page) => page.locator("h1").count();

test("a trip with four people: Overview, People and Expenses do not scroll sideways at 200% text; Home has one h1", async ({ browser }) => {
  test.setTimeout(240_000);
  const people = await Promise.all(["Varun", "Kabir", "Meera", "Asha"].map((n) => signUp(n, testEmail(`bt-${n.toLowerCase()}`))));
  const mk = async (u: (typeof people)[number]) => {
    const ctx = await browser.newContext({ storageState: u.storageState, viewport: phone, isMobile: true, hasTouch: true });
    await allowTestCopy(ctx);
    return ctx.newPage();
  };
  const [owner, ...others] = await Promise.all(people.map(mk));
  const trip = await createGroup(owner, groupName("Thailand trip"), "Trip");
  for (const p of others) await joinGroup(p, trip.invite, trip.path);

  for (const q of ["", "?tab=balances", "?tab=activity"]) {
    await owner.goto(`${trip.path}${q}`);
    await settled(owner);
    await bigText(owner);
    await owner.waitForTimeout(400);
    // The page is no wider than the phone (the browser widens its window to a too-wide page, so judge scrollWidth against 390).
    expect(await owner.evaluate(() => document.documentElement.scrollWidth), `trip ${q || "overview"}: no sideways scroll at 200% text`).toBeLessThanOrEqual(phone.width + 1);
    expect(await h1s(owner), `trip ${q || "overview"}: one h1`).toBe(1);
  }

  // Home with a group: exactly one main heading (a hidden "Home"; the visible look is unchanged).
  await owner.goto("/");
  await settled(owner);
  await expect(owner.locator("[data-greeting]")).toBeVisible(); // the with-groups Home, not the start screen
  expect(await h1s(owner), "Home with groups: one h1").toBe(1);
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText("Home");
});

test("the first-visit tour and the start screen each have exactly one h1", async ({ page, context }) => {
  await allowTestCopy(context);
  await page.goto("/");
  await settled(page);
  await expect(page.locator("[data-tour-next]")).toBeVisible();
  expect(await h1s(page), "tour: one h1").toBe(1);
  await page.locator("[data-tour-next]").click();
  await page.waitForTimeout(500);
  expect(await h1s(page), "tour, second slide: still one h1").toBe(1);
  await page.getByRole("link", { name: "Skip" }).click();
  await page.waitForURL(/\/groups\/new/);
  await page.goto("/");
  await settled(page);
  await expect(page.getByRole("heading", { name: "Good times. Shared fairly." })).toBeVisible();
  expect(await h1s(page), "start screen: one h1").toBe(1);
});
