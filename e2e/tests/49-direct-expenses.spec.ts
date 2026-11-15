import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Expenses with one person, no group. Asha and Ravi share a trip (so Ravi can be picked), then add an expense with each other directly.
// Hand-worked: Asha pays ₹1,200, split both equally -> Ravi owes her ₹600. Then Ravi pays ₹900, split both equally: ₹450 each,
// Ravi owes 600 - 450 = ₹150. On 320, 360 and 390 px phones.
const SIZES = [{ w: 320, h: 640 }, { w: 360, h: 740 }, { w: 390, h: 844 }];

test("with a person: pick, add, see who owes what, the other side sees it, and it never opens as a group", async ({ browser }) => {
  test.setTimeout(240_000);
  const asha = await signUp("Asha", testEmail("direct-asha"));
  const ravi = await signUp("Ravi", testEmail("direct-ravi"));
  const page = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const trip = await createGroup(page, groupName("Goa trip"), "Trip");
  await joinGroup(R, trip.invite, trip.path);

  // The + asks first: with a person, or in a group.
  await page.goto("/add");
  await settled(page);
  await expect(page.getByRole("link", { name: /With a person/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /In a group/ })).toBeVisible();
  await page.getByRole("link", { name: /With a person/ }).click();
  await page.waitForURL(/\/add\/person/);
  await settled(page);

  for (const { w, h } of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no sideways scroll at ${w}`).toBe(true);
    const row = page.locator("[data-person-row='Ravi']");
    await expect(row, `Ravi is offered at ${w}`).toBeVisible();
    expect((await row.boundingBox())!.height, `row is a 44px target at ${w}`).toBeGreaterThanOrEqual(43);
  }

  // Pick Ravi: straight to Add expense with him (no photo, no group chrome).
  await page.locator("[data-person-row='Ravi']").click();
  await page.waitForURL(/\/groups\/[^/]+\/add/);
  await settled(page);
  await expect(page.getByText("Add expense with Ravi")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0); // no place photo for a person
  await page.locator("#expense-name").fill("Lunch");
  await page.getByLabel("Amount", { exact: true }).fill("1200");
  await page.locator("[data-split-row]").waitFor();
  await page.getByRole("button", { name: "Both equally" }).click();
  await expect(page.locator("[data-pair-line]")).toContainText("Ravi owes you ₹600");
  await page.getByRole("button", { name: "Save expense" }).click();
  await page.waitForURL(/\/people\/[^/?]+/);
  await settled(page);
  const personUrl = new URL(page.url()).pathname;
  await expect(page.locator("[data-balance-line]")).toContainText("Ravi owes you ₹600");
  await expect(page.locator("[data-person-history]")).toContainText("Lunch");

  // The group screens never open for a pair: the address bounces to the person's page.
  const groupId = personUrl.split("/").pop()!;
  await page.goto(`/groups/${groupId}/settings`);
  await page.waitForURL(new RegExp(`/people/${groupId}`));

  // Ravi sees it from his side, then adds his own expense.
  await R.goto("/settle");
  await settled(R);
  await expect(R.getByText("Asha").first()).toBeVisible();
  await R.goto(personUrl);
  await settled(R);
  await expect(R.locator("[data-balance-line]")).toContainText("You owe Asha ₹600");
  await R.goto(`/groups/${groupId}/add`);
  await settled(R);
  await R.locator("#expense-name").fill("Taxi");
  await R.getByLabel("Amount", { exact: true }).fill("900");
  await R.locator("[data-split-row]").waitFor();
  await R.getByRole("button", { name: "Both equally" }).click();
  await R.getByRole("button", { name: "Save expense" }).click();
  await R.waitForURL(/\/people\/[^/?]+/);
  await settled(R);
  // The person adding pays by default: Ravi paid 900, 450 each, so Asha owes him 450 against the 600 he owed her: ₹150 left.
  await expect(R.locator("[data-balance-line]")).toContainText("You owe Asha ₹150");

  // The Settle screen lists the person in its own section, apart from groups.
  await page.goto("/settle");
  await settled(page);
  await expect(page.getByText(/WITH PEOPLE DIRECTLY/i)).toBeVisible();
});
