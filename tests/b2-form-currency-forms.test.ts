import { afterAll, describe, expect, it, vi } from "vitest";

// M3 for the other money forms: a bill, shopping "bought", budgets, deposit and goal page drawn in one currency must not save amounts
// after the group's currency changed (or when the page has no currency at all). Each refused post writes nothing; the same post in the
// group's own currency is accepted (for the forms that are easy to fill in), so the refusal is not a side effect of something else.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { encodeSession, today } = await import("@/lib/session");
const B = await import("@/app/bill-actions");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(fn: () => Promise<unknown>): Promise<URL> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return new URL(m[1], "http://loopin.test");
  }
  throw new Error("expected a redirect");
}

// A home group in rupees with Asha and Ravi (both signed-in accounts); the page was "drawn" before the group went to rupees (USD).
async function world() {
  const [asha, ravi] = await Promise.all(["asha", "ravi"].map((n) => db.account.create({ data: { email: `fc-${n}-${Math.random().toString(36).slice(2, 7)}-${stamp}@example.test`, name: n } })));
  accountIds.push(asha.id, ravi.id);
  const g = await db.group.create({
    data: {
      name: `FC ${stamp}-${Math.random().toString(36).slice(2, 5)}`, type: "home", currency: "INR", inviteCode: `fc-${Math.random().toString(36).slice(2, 9)}-${stamp}`,
      members: { create: [{ name: "Asha", accountId: asha.id, createdAt: new Date(2026, 0, 1), claimedAt: new Date(2026, 0, 1) }, { name: "Ravi", accountId: ravi.id, createdAt: new Date(2026, 0, 2), claimedAt: new Date(2026, 0, 2) }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  state.cookie = await encodeSession({ m: {}, a: asha.id, v: asha.sessionVersion, t: today() });
  return { gid: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
}

describe("a money form drawn in another currency, or with none, saves nothing", () => {
  it("budgets: USD and a missing currency write no budget; INR writes 5,000.00 rupees = 500,000 paise", async () => {
    const w = await world();
    for (const cur of [{ currency: "USD" }, {}]) {
      await redirectOf(() => B.saveBudgets(form({ groupId: w.gid, b_food: "5000", ...cur })));
      expect(await db.budget.count({ where: { groupId: w.gid } })).toBe(0);
    }
    await redirectOf(() => B.saveBudgets(form({ groupId: w.gid, b_food: "5000", currency: "INR" })));
    expect((await db.budget.findMany({ where: { groupId: w.gid } })).map((b) => [b.category, b.amount])).toEqual([["food", 500000]]);
  });

  it("goal: a new goal of 20,000 rupees from a USD page is refused; from an INR page it is saved as 2,000,000 paise; a goal entry of 18 from a USD page is refused", async () => {
    const w = await world();
    await redirectOf(() => B.saveGoal(form({ groupId: w.gid, name: "Trip fund", target: "20000", currency: "USD" })));
    expect(await db.goal.count({ where: { groupId: w.gid } })).toBe(0);
    await redirectOf(() => B.saveGoal(form({ groupId: w.gid, name: "Trip fund", target: "20000", currency: "INR" })));
    const goal = await db.goal.findFirstOrThrow({ where: { groupId: w.gid } });
    expect(goal.target).toBe(2000000);
    await redirectOf(() => B.addGoalEntry(form({ groupId: w.gid, goalId: goal.id, amount: "18", currency: "USD" })));
    expect(await db.goalEntry.count({ where: { goalId: goal.id } })).toBe(0);
    await redirectOf(() => B.addGoalEntry(form({ groupId: w.gid, goalId: goal.id, amount: "18", currency: "INR", rid: `fc-goal-entry-${stamp}-aaaa` })));
    expect((await db.goalEntry.findMany({ where: { goalId: goal.id } })).map((e) => e.amount)).toEqual([1800]);
  });

  it("bill: a USD page or no currency creates no bill; the same form in INR creates it", async () => {
    const w = await world();
    const base = { groupId: w.gid, template: "other", name: "Wifi", nature: "fixed", amount: "1000", day: "1", payer: w.asha, split: "group" };
    await redirectOf(() => B.saveBill(form({ ...base, currency: "USD" })));
    await redirectOf(() => B.saveBill(form(base)));
    expect(await db.bill.count({ where: { groupId: w.gid } })).toBe(0);
    await redirectOf(() => B.saveBill(form({ ...base, currency: "INR" })));
    expect((await db.bill.findMany({ where: { groupId: w.gid } })).map((b) => [b.name, b.amount])).toEqual([["Wifi", 100000]]); // ₹1,000 = 100,000 paise
  });

  it("deposit: a USD page saves no deposit and returns none; the same form in INR saves ₹5,000 (500,000 paise) each", async () => {
    const w = await world();
    const post = (currency: string) => B.saveDeposit(form({ groupId: w.gid, heldBy: "Landlord", [`d_${w.asha}`]: "5000", [`d_${w.ravi}`]: "5000", currency }));
    await redirectOf(() => post("USD"));
    expect(await db.deposit.count({ where: { groupId: w.gid } })).toBe(0);
    await redirectOf(() => B.returnDeposit(form({ groupId: w.gid, deductions: "100", currency: "USD" })));
    expect(await db.deposit.count({ where: { groupId: w.gid } })).toBe(0);
    await redirectOf(() => post("INR"));
    const shares = await db.depositShare.findMany({ where: { deposit: { groupId: w.gid } } });
    expect(shares.map((x) => x.amount)).toEqual([500000, 500000]);
  });

  it("shopping 'bought': a USD page records no expense; the same form in INR records ₹250 (25,000 paise) shared 12,500 each", async () => {
    const w = await world();
    await db.listItem.create({ data: { groupId: w.gid, text: "Milk", addedById: w.asha, boughtById: w.asha, boughtAt: new Date() } });
    await redirectOf(() => B.listBuy(form({ groupId: w.gid, amount: "250", currency: "USD", rid: `fc-buy-${stamp}-aaaaaa` })));
    expect(await db.expense.count({ where: { groupId: w.gid } })).toBe(0);
    await redirectOf(() => B.listBuy(form({ groupId: w.gid, amount: "250", currency: "INR", rid: `fc-buy-${stamp}-bbbbbb` })));
    const list = await db.expense.findMany({ where: { groupId: w.gid }, include: { shares: true } });
    expect(list.map((e) => e.amount)).toEqual([25000]);
    expect(list[0].shares.map((x) => x.amount).sort()).toEqual([12500, 12500]);
    const net = await checkBooks(w.gid);
    expect([net[w.asha], net[w.ravi]]).toEqual([12500, -12500]);
  });
});
