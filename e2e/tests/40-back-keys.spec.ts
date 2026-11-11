import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { db } from "../helpers/db";
import { addEqualExpense, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// The Back button can bring back a money form exactly as it was left, including the
// one-time key it carried. Each new visit to the screen gets a fresh key, so recording
// the same amount twice really records it twice; and a screen holding a used key can
// never save a different amount by mistake.
//
// Worked out: Asha pays ₹1,200 split equally, so Ravi owes ₹600. Ravi records ₹100
// (10000) twice, then tries once more with an old key.
test("Back button: the same amount twice is two payments; a used key is refused", async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await signUp("Asha", testEmail("back-asha"));
  const ravi = await signUp("Ravi", testEmail("back-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  const g = await createGroup(A, groupName("Back keys"), "Trip");
  await joinGroup(R, g.invite, g.path);
  await addEqualExpense(A, g.path, "Dinner", "1200");
  const groupId = g.path.split("/").pop()!;
  const payments = () => db.payment.count({ where: { groupId, deletedAt: null } });
  const markPaid = () => R.locator("form").filter({ has: R.getByLabel(/^Amount (You|Ravi) paid Asha$/) }).first();

  // Ravi records ₹100 from Settle up.
  await R.goto(`${g.path}/settle`);
  await settled(R);
  const rid = R.locator('form input[name="rid"]').first();
  await expect(rid).toHaveValue(/^[A-Za-z0-9-]{16,64}$/);
  const firstKey = await rid.inputValue();
  let form = markPaid();
  await form.getByLabel(/^Amount (You|Ravi) paid Asha$/).fill("100");
  await form.getByRole("button", { name: "Mark paid" }).click();
  await expect.poll(payments).toBe(1);

  // Goes somewhere else, then Back to the same screen: records ₹100 again. That is a second payment.
  await R.waitForURL(/paid=1/);
  await R.goto(g.path);
  await settled(R);
  await R.goBack();
  await settled(R);
  await expect(R.locator('form input[name="rid"]').first()).toHaveValue(/^[A-Za-z0-9-]{16,64}$/);
  form = markPaid();
  await form.getByLabel(/^Amount (You|Ravi) paid Asha$/).fill("100");
  await form.getByRole("button", { name: "Mark paid" }).click();
  await expect.poll(payments).toBe(2);
  expect(await db.payment.count({ where: { groupId, amount: 10000, deletedAt: null } })).toBe(2);

  // A saved copy of the screen coming back (pageshow, persisted) makes a fresh key; an ordinary pageshow does not.
  await R.goto(`${g.path}/settle`);
  await settled(R);
  const before = await rid.inputValue();
  expect(before).not.toBe(firstKey);
  await R.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  await expect(rid).toHaveValue(before);
  await R.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(rid).not.toHaveValue(before);

  // Safety net: a screen that still holds the first (used) key and a different amount saves nothing.
  await R.evaluate((k) => {
    (document.querySelector('form input[name="rid"]') as HTMLInputElement).value = k;
  }, firstKey);
  form = markPaid();
  await form.getByLabel(/^Amount (You|Ravi) paid Asha$/).fill("200");
  await form.getByRole("button", { name: "Mark paid" }).click();
  await expect(R.getByText("This screen was out of date, so nothing new was saved. Check the list, and tap again if it’s missing.")).toBeVisible();
  expect(await payments()).toBe(2);

  await A.context().close();
  await R.context().close();
});
