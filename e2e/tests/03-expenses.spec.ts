import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp, type TestUser } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, openEdit, readBalances, settled } from "../helpers/app";

// 3 and 4. Three people in one trip: an equal split, then an edit.
// The tests in this file run in order and share the group.
test.describe.configure({ mode: "serial" });

let alice: TestUser, bob: TestUser, cara: TestUser;
let A: Page, B: Page;
const contexts: BrowserContext[] = [];
let group = { path: "", invite: "" };

test.beforeAll(async ({ browser }) => {
  alice = await signUp("Alice", testEmail("alice"));
  bob = await signUp("Bob", testEmail("bob"));
  cara = await signUp("Cara", testEmail("cara"));
  const [ca, cb, cc] = await Promise.all([alice, bob, cara].map((u) => contextFor(browser, u)));
  contexts.push(ca, cb, cc);
  A = await ca.newPage();
  B = await cb.newPage();
  const C = await cc.newPage();
  group = await createGroup(A, groupName("Three friends"));
  await joinGroup(B, group.invite, group.path);
  await joinGroup(C, group.invite, group.path);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
});

test("equal split across three people: ₹900 dinner → Alice gets ₹600, Bob and Cara owe ₹300 each", async () => {
  await addEqualExpense(A, group.path, "Dinner", "900");
  await expect(A.locator("details summary").filter({ hasText: "Dinner" }).first()).toBeVisible();

  const seenByAlice = await readBalances(A, group.path);
  expect(seenByAlice).toEqual({ Alice: 60000, Bob: -30000, Cara: -30000 });
  // Bob sees the same numbers from his phone.
  const seenByBob = await readBalances(B, group.path);
  expect(seenByBob).toEqual(seenByAlice);
  expect(Object.values(seenByAlice).reduce((a, b) => a + b, 0)).toBe(0);
});

test("must-fail check: a wrong expected balance is caught", async () => {
  // Marked as expected to fail: if this ever "passes", the checks have gone blind.
  test.fail();
  const shown = await readBalances(A, group.path);
  expect(shown.Alice).toBe(60100); // deliberately ₹1 off
});

test("edit the amount (₹900 → ₹1,200): balances recalculate to +₹800 / −₹400 / −₹400", async () => {
  await openEdit(A, group.path, "Dinner");
  await A.getByLabel("Amount", { exact: true }).fill("1200");
  await A.getByRole("button", { name: "Everyone equally" }).click();
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  await settled(A);
  await expect(A.locator("details summary").filter({ hasText: "Dinner" }).first()).toContainText("1,200");

  expect(await readBalances(A, group.path)).toEqual({ Alice: 80000, Bob: -40000, Cara: -40000 });
  expect(await readBalances(B, group.path)).toEqual({ Alice: 80000, Bob: -40000, Cara: -40000 });
});
