import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, contextFor, createGroup, readBalances, settled } from "../helpers/app";
import { db, latestCode } from "../helpers/db";

// Joining without an account, end to end: open the link signed out, join as a new name, add an expense, find that someone else's expense
// opens the sign-in sheet, sign in with email (the test mail outbox), and still be the same person with the same money.
test.describe.configure({ mode: "serial" });

let hostCtx: BrowserContext;
let host: Page;
let g = { path: "", invite: "" };

test.beforeAll(async ({ browser }) => {
  const user = await signUp("Hana", testEmail("guesthost"));
  hostCtx = await contextFor(browser, user);
  host = await hostCtx.newPage();
  g = await createGroup(host, groupName("Guest join"));
  await addEqualExpense(host, g.path, "Dinner", "1200");
});
test.afterAll(async () => hostCtx?.close());

test("a guest joins from the link, adds Taxi, is asked to sign in for Hana's Dinner, signs in, and is still Ben with the same money", async ({ context, page }) => {
  await allowTestCopy(context);
  const groupId = g.path.split("/").pop()!;

  // 1. Open the link signed out: Join, and the sign-in link; no name box yet, and no amounts.
  await page.goto(g.invite);
  await settled(page);
  await expect(page.getByRole("link", { name: /^Join / })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("No amounts are shown before you join.")).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);
  await page.getByRole("link", { name: /^Join / }).click();
  await settled(page);

  // 2. Hana is the only name and she has an account, so there is no list: the new-name form. Pick "Ben".
  await page.locator('input[name="name"]').fill("Ben");
  await page.getByRole("button", { name: "Join as someone new" }).click();
  await page.waitForURL(new RegExp(`${g.path}$`));
  await settled(page);
  const ben = await db.member.findFirstOrThrow({ where: { groupId, name: "Ben" } });
  expect(ben.accountId).toBeNull();
  await expect(page.locator("[data-guest-card]")).toBeVisible();
  await expect(page.getByText("You’re Ben, on this phone")).toBeVisible();

  // 3. Add Taxi 900.00, split equally between Hana and Ben (450.00 each).
  await addEqualExpense(page, g.path, "Taxi", "900");
  const taxi = await db.expense.findFirstOrThrow({ where: { groupId, description: "Taxi" } });
  expect(taxi.createdById).toBe(ben.id);
  const before = await readBalances(page, g.path);

  // 4. Hana's Dinner: Edit or delete opens the sheet that names her, instead of the edit screen.
  await page.goto(`${g.path}?tab=activity&q=Dinner`);
  await settled(page);
  await page.locator('li[id^="item-"] details > summary').filter({ hasText: "Dinner" }).first().click();
  await page.locator('[data-signin-open="edit"]').first().click();
  const sheet = page.locator("[data-signin-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Sign in to change Hana’s expense")).toBeVisible();
  await expect(sheet.getByText("Changing things for the whole group needs a sign-in, so everyone can see who changed what. Your own expenses you can change any time.")).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);
  // Nothing changed.
  expect((await db.expense.findFirstOrThrow({ where: { groupId, description: "Dinner" } })).amount).toBe(120000);

  // 5. Sign in with email (the test mail outbox). The check asks before the group moves.
  const email = testEmail("ben");
  await page.goto(`/signin?${new URLSearchParams({ back: g.path })}`);
  await page.locator('input[name="name"]').fill("Ben");
  await page.locator('input[name="email"]').fill(email);
  const since = new Date(Date.now() - 2_000);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForURL(/sent=1/);
  await page.locator('input[name="code"]').fill(await latestCode(email, since));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("[data-guest-sheet]").waitFor();
  await page.locator("[data-guest-move]").click();
  await page.waitForURL(/signedin=1/);

  // 6. Still Ben: the same member row (now with the account), Taxi still his, the same balances, and the guest card gone.
  const after = await db.member.findUniqueOrThrow({ where: { id: ben.id } });
  expect(after.accountId).not.toBeNull();
  expect(after.name).toBe("Ben");
  expect((await db.expense.findUniqueOrThrow({ where: { id: taxi.id } })).createdById).toBe(ben.id);
  await page.goto(g.path);
  await settled(page);
  await expect(page.locator("[data-guest-card]")).toHaveCount(0);
  expect(await readBalances(page, g.path)).toEqual(before);
});
