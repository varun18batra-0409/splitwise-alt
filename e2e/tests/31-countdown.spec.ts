import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, settled } from "../helpers/app";

// Trip countdown: dates set when making a trip show "in 12 days" on the group
// and on Home; changing them in settings updates it; the share picture is made.
const day = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + plus * 86_400_000));

test("a trip with dates counts down on the group and Home; settings change it; the picture is made", async ({ browser }) => {
  const user = await signUp("Tara", testEmail("countdown"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  const name = groupName("Goa trip");

  await page.goto("/groups/new");
  await settled(page);
  await page.getByRole("button", { name: /^Trip/ }).click();
  await page.locator('input[name="groupName"]').fill(name);
  await page.locator('input[name="tripStart"]').fill(day(12));
  await page.locator('input[name="tripEnd"]').fill(day(16));
  await page.locator('select[name="currency"]').selectOption("INR");
  await page.getByRole("button", { name: /Create group/ }).click();
  await page.waitForURL(/\/invite\?new=1/);
  const path = new URL(page.url()).pathname.replace(/\/invite$/, "");

  await page.goto(path);
  await settled(page);
  await expect(page.locator("[data-countdown-line]").first()).toContainText("in 12 days");

  await page.goto("/");
  await settled(page);
  // No tagline on Home (founder, 15 Nov): it lives on the opening screen, the app description, shared pictures and How Loopin works.
  await expect(page.locator("[data-tagline]")).toHaveCount(0);
  // "Coming up": the trip's countdown card (its polaroid, "12 days to go").
  const card = page.locator("[data-trip-pass]");
  await expect(card).toHaveAttribute("data-countdown", "12");
  await expect(card.locator("[data-countdown-big]")).toContainText("12");
  // The quiet line: the start day and the head count, no names line; Share sits under the polaroid and is at least 44px tall.
  await expect(card.locator("[data-trip-meta]")).toHaveText(/^\d{1,2} [A-Z][a-z]+( \d{4})? · 1 person$/);
  await expect(card).not.toContainText(/\bwith [A-Z]/);
  const share = await card.getByRole("button", { name: "Share" }).boundingBox();
  const polaroid = await card.getByRole("link", { name: /^Open / }).first().boundingBox(); // the polaroid (a drawn cover when the trip has no photo)
  expect(share!.height).toBeGreaterThanOrEqual(44);
  expect(share!.y).toBeGreaterThan(polaroid!.y + polaroid!.height - 12);

  // Share: WhatsApp, everyone in the trip (in Loopin), more apps.
  await card.getByRole("button", { name: "Share" }).click();
  const sheet = page.getByRole("dialog", { name: "Share the countdown" });
  for (const b of [/WhatsApp/, /Everyone in the trip/, /Other apps/]) await expect(sheet.getByRole("button", { name: b })).toBeVisible();
  await sheet.getByRole("button", { name: /Everyone in the trip/ }).click();
  await expect(sheet.getByRole("status")).toHaveText("Sent to everyone in the trip ✓");
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.goto(`${path}?tab=activity`);
  await settled(page);
  await expect(page.getByText(/is counting down: .*in 12 days/).first()).toBeVisible();

  // The share picture: a real PNG, only for people in the group.
  const img = await page.request.get(`${path}/countdown-image`);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toContain("image/png");
  expect((await img.body()).length).toBeGreaterThan(10_000);

  // Settings: move it to tomorrow.
  await page.goto(`${path}/settings`);
  await settled(page);
  await page.locator('input[name="tripStart"]').fill(day(1));
  await page.locator('input[name="tripEnd"]').fill(day(3));
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForURL(new RegExp(`${path}\\?`));
  await expect(page.locator("[data-countdown-line]").first()).toContainText("tomorrow");

  // Ending before it starts is refused, and nothing changes.
  await page.goto(`${path}/settings`);
  await settled(page);
  await page.locator('input[name="tripStart"]').fill(day(5));
  await page.locator('input[name="tripEnd"]').fill(day(2));
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("The trip can’t end before it starts.")).toBeVisible();

  // A second, later trip: Coming up is one stack of passes, earliest first.
  await page.goto("/groups/new");
  await settled(page);
  await page.getByRole("button", { name: /^Trip/ }).click();
  await page.locator('input[name="groupName"]').fill(groupName("Manali trip"));
  await page.locator('input[name="tripStart"]').fill(day(40));
  await page.locator('select[name="currency"]').selectOption("INR");
  await page.getByRole("button", { name: /Create group/ }).click();
  await page.waitForURL(/\/invite\?new=1/);
  await page.goto("/");
  await settled(page);
  const passes = page.locator("[data-trip-pass]");
  await expect(passes).toHaveCount(2);
  await expect(passes.first()).toHaveAttribute("data-countdown", "1");
  await expect(passes.first().locator("[data-countdown-big]")).toContainText(/1|Tomorrow/);
  await expect(passes.nth(1)).toHaveAttribute("data-countdown", "40");
  await expect(page.locator("[data-trip-also]")).toHaveCount(0);
  await expect(page.locator("[data-trip-row]")).toHaveCount(0);
  await ctx.close();

  // Someone outside the group can't get the picture.
  const outsider = await browser.newContext();
  const res = await outsider.request.get(`${path}/countdown-image`, { headers: {} });
  expect([401, 403, 404]).toContain(res.status());
  await outsider.close();
});
