import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, settled } from "../helpers/app";

// 2. A test person signs up with the email code (outside the recorded trace),
// is signed in, and makes a group.
test("sign up with an email code, then create a group", async ({ browser }) => {
  const email = testEmail("solo");
  const user = await signUp("Sol", email);
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();

  await page.goto("/account");
  await settled(page);
  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const name = groupName("Solo trip");
  const g = await createGroup(page, name);
  await expect(page.getByText("is ready. Now bring your people in")).toBeVisible();
  await page.goto(g.path);
  await settled(page);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("All square")).toBeVisible();

  // Your profile: change your name; it changes in the group too (where you had the old one).
  await page.goto("/account");
  await settled(page);
  await expect(page.getByRole("region", { name: "Your profile" }).getByText("Sol", { exact: true })).toBeVisible();
  await page.getByText("Edit name").click();
  await page.getByLabel("Your name").fill("Solomon");
  await expect(page.getByLabel(/Also change it in the 1 group where you’re Sol/)).toBeChecked();
  await page.screenshot({ path: test.info().outputPath("profile-edit.png") });
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/name=saved/);
  await expect(page.getByText("Name saved, and changed in 1 group.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your profile" }).getByText("Solomon", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("profile-saved.png") });
  await page.goto(`${g.path}/people`);
  await settled(page);
  await expect(page.getByText("Solomon").first()).toBeVisible();
  await ctx.close();
});

test("a wrong sign-in code is refused", async ({ page, context }) => {
  // Only a wrong code is typed here (chosen to differ from the real one, which is never shown).
  const { allowTestCopy } = await import("../helpers/app");
  const { latestCode } = await import("../helpers/db");
  await allowTestCopy(context);
  const email = testEmail("wrongcode");
  await page.goto("/signin");
  await settled(page);
  await page.locator('input[name="email"]').fill(email);
  const since = new Date(Date.now() - 2_000);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForURL(/sent=1/);
  const wrong = (await latestCode(email, since)) === "000000" ? "111111" : "000000";
  await page.locator('input[name="code"]').fill(wrong);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/That code isn't right|expired|Too many/)).toBeVisible();
  await expect(page).not.toHaveURL(/signedin=1/);
});
