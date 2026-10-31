import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Postcards: Asha writes one from the group to Ravi (they share a group); Ravi finds it in his
// postcards (below the passport), opens it, turns it over and can write back. Someone else can't open it.
test("Postcards: write from a group, the other person receives it, turns it over, a stranger can't see it", async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await signUp("Asha", testEmail("pc-asha"));
  const ravi = await signUp("Ravi", testEmail("pc-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const g = await createGroup(A, groupName("Goa trip"), "Trip");
  await joinGroup(R, g.invite, g.path);

  // The group offers it.
  await A.goto(g.path);
  await settled(A);
  await A.locator("[data-send-postcard]").first().click();
  await A.waitForURL(/\/postcards\/new\?group=/);
  await settled(A);
  // Front: a print instead of the photo, then the back.
  await A.getByRole("button", { name: "Print: Mountains" }).click();
  await expect(A.locator("[data-postcard-front] [data-print-svg]").first()).toBeVisible();
  await A.getByRole("tab", { name: "Back" }).click();
  await A.getByRole("button", { name: "Same time next year?" }).click();
  await A.getByRole("textbox", { name: "Your message" }).fill("Wish you were here. The beach shack was the fancy dinner.");
  await A.getByRole("tab", { name: "Send" }).click();
  await A.locator("[data-recipient='Ravi']").click();
  await A.getByRole("button", { name: "Send to 1 person" }).click();
  await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
  const path = new URL(A.url()).pathname;
  await expect(A.getByText(/Sent\. It’s waiting in their postcards/)).toBeVisible();

  // Ravi: in his passport and on his shelf, marked new; opening it shows the message on the back.
  await R.goto("/account");
  await settled(R);
  await expect(R.locator("[data-postcards-link]")).toContainText("1 new");
  await R.goto(path);
  await settled(R);
  const flip = R.locator("[data-postcard-flip]");
  await expect(flip).toHaveAttribute("data-postcard-flip", "front");
  await flip.click();
  await expect(flip).toHaveAttribute("data-postcard-flip", "back");
  await expect(R.locator("[data-back-message]")).toContainText("fancy dinner");
  await expect(R.getByRole("link", { name: "Write back" })).toBeVisible();
  await R.goto("/postcards");
  await settled(R);
  await expect(R.locator("[data-postcard-item]")).toHaveCount(1);

  // Someone who isn't the sender or the receiver gets nothing.
  const stranger = await signUp("Zed", testEmail("pc-zed"));
  const Z = await (await contextFor(browser, stranger)).newPage();
  const res = await Z.goto(path);
  expect(res?.status()).toBe(404);
  const anon = await browser.newContext();
  await allowTestCopy(anon);
  const N = await anon.newPage();
  await N.goto(path);
  await N.waitForURL(/\/signin/);
});
