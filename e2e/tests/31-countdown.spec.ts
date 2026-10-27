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
  const card = page.getByRole("region", { name: "Trip countdown", exact: true });
  await expect(card).toHaveAttribute("data-countdown", "12");
  await expect(card.locator("[data-countdown-big]")).toHaveText("12");

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

  // A second, later trip: the soonest stays big at the top of Home, the later one shows under "Also coming up".
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
  await expect(page.locator("[data-home-hero]")).toHaveAttribute("data-countdown", "1");
  await expect(page.locator("[data-home-hero] [data-hero-big]")).toHaveText("tomorrow");
  const row = page.locator("[data-trip-row]");
  await expect(row.getByRole("region", { name: "Trip countdown", exact: true })).toHaveCount(1);
  await expect(row.locator("[data-countdown]").nth(0)).toHaveAttribute("data-countdown", "40");
  await ctx.close();

  // Someone outside the group can't get the picture.
  const outsider = await browser.newContext();
  const res = await outsider.request.get(`${path}/countdown-image`, { headers: {} });
  expect([401, 403, 404]).toContain(res.status());
  await outsider.close();
});
