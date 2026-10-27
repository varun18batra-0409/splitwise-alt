import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// The "I've paid" link in a Remind message: Ravi owes Asha, opens the link on a
// phone that isn't signed in, says he paid, takes it back, says it again; Asha
// confirms in Loopin; the link then says all square and can't be used again.
test("Remind → I've paid without signing in → Asha confirms → all square", async ({ browser }) => {
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
  await expect(P.locator("[data-i-paid]")).toHaveCount(0);

  // Took it back by mistake, then says it again.
  await P.getByRole("button", { name: "Tapped by mistake? Take it back" }).click();
  await P.waitForURL(/undone=1/);
  await expect(P.locator("[data-paylink='owes']")).toBeVisible();
  await P.locator("[data-i-paid]").click();
  await expect(P.locator("[data-paylink='said']")).toBeVisible();

  // Asha is asked, and confirms.
  await A.goto(`${g.path}/settle`);
  await settled(A);
  const ask = A.locator("[data-waiting='Ravi']");
  await expect(ask).toHaveCount(1);
  await ask.getByRole("button", { name: /Got it/ }).click();
  await A.waitForURL(/settle/);
  await expect(A.locator("[data-waiting='Ravi']")).toHaveCount(0);

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
