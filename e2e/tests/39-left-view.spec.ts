import { test, expect } from "../fixtures";
import { baseURL, bypassHeaders, testEmail, groupName } from "../env";
import type { SaveExpenseInput } from "../../src/lib/save-expense";
import type { RateAnswer } from "../../src/lib/rate-cache";
import { signUp } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Someone who left sees the group only up to the day they left, plus later changes to their own share.
//
// Asha, Ravi and Meera share a trip equally. Dinner ₹900 (Asha paid): ₹300 each. Ravi pays Asha ₹300, so
// Ravi is square, and leaves. Then Meera adds Taxi ₹600 shared by Asha and Meera, and Asha changes
// Dinner to take Ravi out (₹450 each for Asha and Meera). Ravi's own balance is +₹300 (the whole
// ledger's), he sees Dinner, his payment and the "changed Dinner" line, and never Taxi.
test("someone who left sees the group up to that day; their share can't be changed after they left", async ({ browser }) => {
  test.setTimeout(180_000);
  const asha = await signUp("Asha", testEmail("lv-asha"));
  const ravi = await signUp("Ravi", testEmail("lv-ravi"));
  const meera = await signUp("Meera", testEmail("lv-meera"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const M = await (await contextFor(browser, meera)).newPage();
  const g = await createGroup(A, groupName("Left view"), "Trip");
  await joinGroup(R, g.invite, g.path);
  await joinGroup(M, g.invite, g.path);
  await addEqualExpense(A, g.path, "Dinner", "900");

  const { db } = await import("../helpers/db");
  const { setMemberLeft } = await import("../../src/lib/people");
  const { saveExpense } = await import("../../src/lib/save-expense");
  const gid = g.path.split("/").pop()!;
  const id = async (name: string) => (await db.member.findFirstOrThrow({ where: { groupId: gid, name } })).id;
  const [a, r, m] = [await id("Asha"), await id("Ravi"), await id("Meera")];
  const dinner = await db.expense.findFirstOrThrow({ where: { groupId: gid, description: "Dinner" } });

  // Ravi pays Asha ₹300 (30000), so he's square, and leaves.
  await db.payment.create({ data: { groupId: gid, fromId: r, toId: a, amount: 30000, createdById: r } });
  const left = await setMemberLeft(gid, r, r, true);
  expect(left.ok).toBe(true);
  await new Promise((done) => setTimeout(done, 50));

  // After he left: Meera's Taxi, and Asha tries to take Ravi out of Dinner. That would move the balance of someone who has
  // left (0 → owed ₹300), so it is refused: he has to rejoin first.
  const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-11" });
  const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
    groupId: gid, name: "Taxi", category: "", amount: "600", currency: "INR", paidById: m, forMode: "selected", selected: [a, m], onePersonId: "",
    splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
  });
  const taxi = await saveExpense(input({}), m, rate);
  expect(taxi.ok).toBe(true);
  const edit = await saveExpense(input({ expenseId: dinner.id, name: "Dinner", amount: "900", paidById: a, rateMode: "keep" }), a, rate);
  expect(edit).toEqual({ ok: false, error: "Ravi has left the group, so their share can't change. Ask them to rejoin first." });

  // Ravi's view of the group.
  await R.goto(g.path);
  await settled(R);
  await expect(R.locator("[data-left-banner]")).toContainText("You left on");
  await expect(R.locator("[data-left-banner]")).toContainText("You see the group up to that day, plus any later change to your own share.");
  // Nothing about his share changed after he left.
  await expect(R.locator("[data-left-after]")).toHaveCount(0);
  await expect(R.getByText("Dinner").first()).toBeVisible();
  await expect(R.getByText("Taxi")).toHaveCount(0);
  await expect(R.locator("[data-left-footnote]")).toContainText("New expenses the group adds without you aren’t shown.");
  // Only Overview, Expenses and People (and Memories, read-only).
  for (const t of ["This month", "Bills", "List", "Games"]) await expect(R.getByRole("link", { name: t, exact: true })).toHaveCount(0);

  // Balances: only his own line.
  await R.goto(`${g.path}?tab=balances`);
  await settled(R);
  await expect(R.locator("summary", { hasText: "Ravi" })).toHaveCount(1);
  await expect(R.locator("summary", { hasText: "Meera" })).toHaveCount(0);
  await expect(R.locator("summary", { hasText: "Asha" })).toHaveCount(0);

  // The spreadsheet he can download shows the same rows.
  const res = await R.request.get(`${baseURL}${g.path}/export`, { headers: bypassHeaders });
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("Dinner");
  expect(csv).not.toContain("Taxi");

  // Meera still sees everything.
  await M.goto(g.path);
  await settled(M);
  await expect(M.getByText("Taxi").first()).toBeVisible();
});
