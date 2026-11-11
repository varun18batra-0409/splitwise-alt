import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { db } from "../helpers/db";
import { contextFor, createGroup, joinGroup, readBalances, settled } from "../helpers/app";

// Phase 7–8 (the free parts): Asha adds her UPI ID; Ravi types an expense in one
// line; Ravi gets an Open payment app button with the amount filled in and
// says "I've paid" (a claim: nothing moves until Asha confirms), and Asha taps Confirm received.
// Before that, a too-big amount on "Paid a different amount?" asks first and Cancel saves nothing.
test("pay buttons, payment tracking and the quick line", async ({ browser }) => {
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
  await pay.getByRole("button", { name: "Save pay details" }).click();
  await A.waitForURL(/pay=error/);
  await expect(A.getByRole("alert").filter({ hasText: "UPI ID doesn’t look right" })).toBeVisible();
  await settled(A);
  await A.getByRole("region", { name: "How friends pay you back" }).getByLabel("UPI ID (India)").fill("Asha@OKICICI");
  await A.getByRole("region", { name: "How friends pay you back" }).getByRole("button", { name: "Save pay details" }).click();
  await A.waitForURL(/pay=saved/);
  await expect(A.getByRole("region", { name: "How friends pay you back" }).getByLabel("UPI ID (India)")).toHaveValue("asha@okicici");

  // Ravi types it in one line: "Dinner 1000 Asha paid" → the form fills in; he checks and saves.
  await R.goto(`${g.path}/add`);
  await settled(R);
  await R.getByRole("group", { name: "Faster entry" }).getByRole("button", { name: "Type a line" }).click();
  await R.getByLabel("Type the expense in one line").fill("Dinner 1000 Asha paid split with everyone");
  await R.getByRole("button", { name: "Fill", exact: true }).click();
  await expect(R.getByRole("group", { name: "Quick line" }).getByRole("status")).toContainText("Asha paid");
  await expect(R.locator("#expense-name")).toHaveValue("Dinner");
  await expect(R.getByLabel("Amount", { exact: true })).toHaveValue("1000");
  await R.getByRole("button", { name: "Save expense" }).click();
  await R.waitForURL(/tab=activity/);
  expect(await readBalances(R, g.path)).toMatchObject({ Asha: 50000, Ravi: -50000 });

  // Settle up: Ravi gets "Open payment app", which opens his UPI app with ₹500 filled in.
  await R.goto(`${g.path}/settle`);
  await settled(R);
  const upi = R.locator("[data-pay='upi']");
  await expect(upi).toHaveText(/Open payment app/);
  const href = (await upi.getAttribute("href")) ?? "";
  expect(href, href).toMatch(/^upi:\/\/pay\?pa=asha%40okicici&pn=Asha&am=500\.00&cu=INR&tn=/);
  const groupId = g.path.split("/").pop()!;
  const payments = () => db.payment.count({ where: { groupId, deletedAt: null } });

  // A typo with an extra zero: ₹3,000 when Ravi owes ₹500. It asks first; Cancel is focused and saves nothing.
  await R.getByRole("link", { name: "Paid a different amount?" }).click();
  await R.waitForURL(/\/pay\?/);
  await settled(R);
  await R.getByLabel("Amount (INR)").fill("12,50");
  await expect(R.locator("[data-amount-echo='₹12.50']")).toBeVisible(); // how "12,50" was read
  await R.getByLabel("Amount (INR)").fill("3000");
  await R.getByRole("button", { name: "Record payment" }).click();
  await R.waitForURL(/owes=/);
  await expect(R.locator("[data-over-warning]")).toContainText("This is ₹2,500 more than what's owed. Record it anyway?");
  await expect(R.locator("[data-over-cancel]")).toBeFocused();
  await R.locator("[data-over-cancel]").click();
  await R.waitForURL(/\/pay\?/);
  await expect(R.locator("[data-over-warning]")).toHaveCount(0);
  expect(await payments()).toBe(0);

  // Back on Settle up: "I've paid ₹500" is a claim. Ravi's ₹500 owed does not move.
  await R.goto(`${g.path}/settle`);
  await settled(R);
  await R.locator("[data-i-paid]").click();
  await R.waitForURL(/claimed=1/);
  await expect(R.getByText("Waiting for Asha to confirm")).toBeVisible();
  expect(await payments()).toBe(0);
  expect(await readBalances(R, g.path)).toMatchObject({ Asha: 50000, Ravi: -50000 });

  // Asha is asked: did you get it? Confirm received.
  await A.goto(`${g.path}/settle`);
  await settled(A);
  const ask = A.getByRole("region", { name: "Did you get these?" });
  await expect(ask.locator("[data-waiting='Ravi']")).toContainText("Ravi says they paid you ₹500");
  await ask.getByRole("button", { name: "Confirm received" }).click();
  await A.waitForURL(/ok=1/);
  await expect(A.getByRole("region", { name: "Did you get these?" })).toHaveCount(0);
  expect(await payments()).toBe(1);
  await A.goto(`${g.path}?tab=activity`);
  await settled(A);
  await expect(A.getByText(/Confirmed ✓ · ₹500/).first()).toBeVisible();

  await A.context().close();
  await R.context().close();
});
