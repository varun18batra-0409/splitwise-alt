import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, contextFor, createGroup, joinGroup, readBalances, settled } from "../helpers/app";

// The "I've paid" link in a Remind message: Ravi owes Asha, opens the link on a
// phone that isn't signed in, says he paid, takes it back, says it again. "I've paid"
// is only a claim: Asha's balance still shows ₹500 owed until she taps Confirm received.
// She says Not received first (the link tells Ravi, balances unchanged), Ravi taps again,
// she confirms; the link then says all square and can't be used again.
test("Remind → I've paid without signing in → Not received → again → Confirm received → all square", async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await signUp("Asha", testEmail("paid-asha"));
  const ravi = await signUp("Ravi", testEmail("paid-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  const g = await createGroup(A, groupName("Pune weekend"), "Trip");
  await joinGroup(R, g.invite, g.path);
  await addEqualExpense(A, g.path, "Villa", "1000"); // Ravi owes Asha ₹500

  // Asha's Remind opens WhatsApp with the link in the message.
  await A.goto(`${g.path}/settle`);
  await settled(A);
  const remind = A.locator("[data-remind]").first();
  await expect(remind).toBeVisible();
  const res = await A.request.get((await remind.getAttribute("href"))!, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const message = decodeURIComponent(res.headers()["location"] ?? "");
  expect(message).toContain("you owe me ₹500");
  const link = res.headers()["x-pay-link"]!;
  expect(message).toContain(link);
  // Reminding again gives the same link (an older message keeps working).
  const again = await A.request.get((await remind.getAttribute("href"))!, { maxRedirects: 0 });
  expect(again.headers()["x-pay-link"]).toBe(link);

  // Ravi's phone, not signed in.
  const anon = await browser.newContext();
  await allowTestCopy(anon);
  const P = await anon.newPage();
  await P.goto(link);
  await expect(P.locator("[data-paylink='owes']")).toBeVisible();
  await expect(P.locator("[data-paylink-amount]")).toHaveText("₹500");
  await P.locator("[data-i-paid]").click();
  await P.waitForURL(/paid=1/);
  await expect(P.locator("[data-paylink='said']")).toBeVisible();
  await expect(P.getByRole("heading", { name: "Waiting for Asha to confirm" })).toBeVisible();
  await expect(P.locator("[data-i-paid]")).toHaveCount(0);
  // It is only a claim: nothing has moved in the balances yet (Ravi still owes ₹500).
  expect(await readBalances(A, g.path)).toMatchObject({ Asha: 50000, Ravi: -50000 });

  // Took it back by mistake, then says it again.
  await P.getByRole("button", { name: "Tapped by mistake? Take it back" }).click();
  await P.waitForURL(/undone=1/);
  await expect(P.locator("[data-paylink='owes']")).toBeVisible();
  await P.locator("[data-i-paid]").click();
  await expect(P.locator("[data-paylink='said']")).toBeVisible();

  // Asha is asked. First she hasn't received it: nothing changes, and the link tells Ravi.
  await A.goto(`${g.path}/settle`);
  await settled(A);
  const ask = A.locator("[data-waiting='Ravi']");
  await expect(ask).toHaveCount(1);
  await expect(ask).toContainText("Ravi says they paid you ₹500");
  await ask.getByRole("button", { name: "Not received" }).click(); // (the test browser accepts the "are you sure?")
  await A.waitForURL(/declined=1/);
  await expect(A.locator("[data-waiting='Ravi']")).toHaveCount(0);
  expect(await readBalances(A, g.path)).toMatchObject({ Asha: 50000, Ravi: -50000 });
  await P.goto(link);
  await expect(P.locator("[data-paylink='owes']")).toBeVisible();
  await expect(P.locator("[data-paylink-declined]")).toContainText("Asha hasn’t received it yet. Check your payment app, then tap I’ve paid again.");
  await expect(P.locator("[data-paylink-amount]")).toHaveText("₹500");

  // Ravi taps I've paid again; this time Asha confirms, and only now do the balances move.
  await P.locator("[data-i-paid]").click();
  await expect(P.locator("[data-paylink='said']")).toBeVisible();
  await A.goto(`${g.path}/settle`);
  await settled(A);
  await expect(A.locator("[data-waiting='Ravi']")).toHaveCount(1);
  await A.locator("[data-waiting='Ravi']").getByRole("button", { name: "Confirm received" }).click();
  await A.waitForURL(/ok=1/);
  await expect(A.locator("[data-waiting='Ravi']")).toHaveCount(0);
  await A.goto(`${g.path}/settle`);
  await settled(A);
  await expect(A.getByText("Nobody owes anybody here.")).toBeVisible(); // everyone is square now

  // The link is done: all square, nothing to tap.
  await P.goto(link);
  await expect(P.locator("[data-paylink='square']")).toBeVisible();
  await expect(P.getByText(/All square/)).toBeVisible();
  await expect(P.locator("[data-i-paid]")).toHaveCount(0);

  // A link that doesn't exist: a friendly page, never an error.
  const res404 = await P.goto(link.replace(/\/p\/.+$/, "/p/AAAAAAAAAAAAAAAAAAAAAA"));
  expect(res404?.status()).toBe(200);
  await expect(P.locator("[data-paylink='gone']")).toBeVisible();
  await anon.close();
});
