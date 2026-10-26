import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, readBalances, settled } from "../helpers/app";

// Phase 7–8 (the free parts): Asha adds her UPI ID; Ravi types an expense in one
// line; Ravi gets a Pay with UPI button with the amount filled in, marks it
// paid, and Asha confirms "Got it ✓". Then a dinner split by item with tax.
test("pay buttons, payment tracking, quick line and split by item", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("pay-asha"));
  const ravi = await signUp("Ravi", testEmail("pay-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  const g = await createGroup(A, groupName("Pay trip"), "Trip");
  await joinGroup(R, g.invite, g.path);

  // Asha: how friends pay her back. A wrong UPI ID is refused.
  await A.goto("/account#pay");
  await settled(A);
  const pay = A.getByRole("region", { name: "How friends pay you back" });
  await pay.getByLabel("UPI ID (India)").fill("asha");
  await pay.getByRole("button", { name: "Save" }).click();
  await A.waitForURL(/pay=error/);
  await expect(A.getByRole("alert").filter({ hasText: "UPI ID doesn’t look right" })).toBeVisible();
  await settled(A);
  await A.getByRole("region", { name: "How friends pay you back" }).getByLabel("UPI ID (India)").fill("Asha@OKICICI");
  await A.getByRole("region", { name: "How friends pay you back" }).getByRole("button", { name: "Save" }).click();
  await A.waitForURL(/pay=saved/);
  await expect(A.getByRole("region", { name: "How friends pay you back" }).getByLabel("UPI ID (India)")).toHaveValue("asha@okicici");

  // Ravi types it in one line: "Dinner 1000 Asha paid" → the form fills in; he checks and saves.
  await R.goto(`${g.path}/add`);
  await settled(R);
  await R.getByRole("button", { name: /Type it in one line/ }).click();
  await R.getByLabel("Type the expense in one line").fill("Dinner 1000 Asha paid split with everyone");
  await R.getByRole("button", { name: "Fill", exact: true }).click();
  await expect(R.getByRole("group", { name: "Quick line" }).getByRole("status")).toContainText("Asha paid");
  await expect(R.locator("#expense-name")).toHaveValue("Dinner");
  await expect(R.getByLabel("Amount", { exact: true })).toHaveValue("1000");
  await R.getByRole("button", { name: "Save expense" }).click();
  await R.waitForURL(/tab=activity/);
  expect(await readBalances(R, g.path)).toMatchObject({ Asha: 50000, Ravi: -50000 });

  // Settle up: Ravi gets "Pay ₹500 · UPI", which opens the payment app with ₹500 filled in.
  await R.goto(`${g.path}/settle`);
  await settled(R);
  const upi = R.locator("[data-pay='upi']");
  await expect(upi).toHaveText(/Pay ₹500 · UPI/);
  const href = (await upi.getAttribute("href")) ?? "";
  expect(href, href).toMatch(/^upi:\/\/pay\?pa=asha%40okicici&pn=Asha&am=500\.00&cu=INR&tn=/);
  await R.locator("form").filter({ has: R.getByLabel(/^Amount (You|Ravi) paid Asha$/) }).getByRole("button", { name: "Mark paid" }).click();
  await R.waitForURL(/paid=1/);

  // Asha is asked: did you get it? Got it ✓.
  await A.goto(`${g.path}/settle`);
  await settled(A);
  const ask = A.getByRole("region", { name: "Did you get these?" });
  await expect(ask.locator("[data-waiting='Ravi']")).toContainText("Ravi says they paid you ₹500");
  await ask.getByRole("button", { name: "Got it ✓" }).click();
  await A.waitForURL(/ok=1/);
  await expect(A.getByRole("region", { name: "Did you get these?" })).toHaveCount(0);
  await A.goto(`${g.path}?tab=activity`);
  await settled(A);
  await expect(A.getByText(/Confirmed ✓ · ₹500/).first()).toBeVisible();

  // Split by item: Asha's soup ₹300, a ₹900 biryani shared, 10% tax shared by what each had.
  await A.goto(`${g.path}/add`);
  await settled(A);
  await A.locator("#expense-name").fill("Lunch");
  await A.getByRole("button", { name: /By item/ }).click();
  const items = A.getByRole("group", { name: "Split by item" });
  await items.getByLabel("Item 1 name").fill("Soup");
  await items.getByLabel("Item 1 price").fill("300");
  await items.locator("[data-item-row='0']").getByRole("button", { name: "You", exact: true }).click();
  await items.getByLabel("Item 2 name").fill("Biryani");
  await items.getByLabel("Item 2 price").fill("900");
  await items.locator("[data-item-row='1']").getByRole("button", { name: "All", exact: true }).click();
  await items.getByLabel("Tax / GST").fill("10%");
  await expect(items.locator("[data-item-share='You']")).toContainText("₹825");
  await expect(items.locator("[data-item-share='Ravi']")).toContainText("₹495");
  await items.getByRole("button", { name: /Use this split · ₹1,320/ }).click();
  await expect(A.getByLabel("Amount", { exact: true })).toHaveValue("1320");
  await expect(A.getByLabel("Ravi amount")).toHaveValue("495");
  await A.getByRole("button", { name: "Save expense" }).click();
  await A.waitForURL(/tab=activity/);
  // Before lunch everyone was square; now Ravi owes Asha his ₹495.
  expect(await readBalances(A, g.path)).toMatchObject({ Asha: 49500, Ravi: -49500 });

  await A.context().close();
  await R.context().close();
});
