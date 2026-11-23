import { afterAll, describe, expect, it, vi } from "vitest";

// A pause or stop charge (the month so far a daily bill adds when it is paused or stopped) is locked from the moment it is made, like a
// move-out charge: it can't be deleted (button, Activity Undo, anything), can't be edited, and so can never come back. If it is wrong, mark
// missed days before pausing, or add a money-back expense afterwards. Group erase still removes everything.
// Hand-worked: Milk 6,000 a day, paused 20 Nov: 19 × 6,000 = 114,000, shared 57,000 each between Asha and Ravi; Asha paid.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
const A = await import("@/app/actions");
const { billCommand } = await import("@/lib/home/bill-setup");
const { saveExpense } = await import("@/lib/save-expense");
const { undoEvent, applyUndoPayload } = await import("@/lib/undo");
const { chargeLockedText } = await import("@/lib/home/charge-lock");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const LOCKED = "This charge was added when Milk was paused or stopped, so it can't be deleted. If it's wrong, add a money-back expense.";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirected(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (/^NEXT_REDIRECT/.test(String((err as Error)?.message))) return;
    throw err;
  }
}

async function paused() {
  const [asha, ravi] = await Promise.all(["asha", "ravi"].map((n) => db.account.create({ data: { email: `pl-${n}-${Math.random().toString(36).slice(2, 7)}-${stamp}@example.test`, name: n } })));
  accountIds.push(asha.id, ravi.id);
  const g = await db.group.create({
    data: {
      name: `PL ${stamp}-${Math.random().toString(36).slice(2, 5)}`, type: "home", currency: "INR", inviteCode: `pl-${Math.random().toString(36).slice(2, 9)}-${stamp}`,
      members: { create: [{ name: "Asha", accountId: asha.id, createdAt: new Date(2026, 0, 1), claimedAt: new Date(2026, 0, 1) }, { name: "Ravi", accountId: ravi.id, createdAt: new Date(2026, 0, 2), claimedAt: new Date(2026, 0, 2) }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const a = g.members.find((m) => m.name === "Asha")!.id;
  const r = g.members.find((m) => m.name === "Ravi")!.id;
  const bill = await db.bill.create({ data: { groupId: g.id, name: "Milk", category: "groceries", nature: "daily", amount: 6000, startMonth: "2026-11", payer: a, split: JSON.stringify({ mode: "equal" }), tz: "Asia/Kolkata" } });
  state.cookie = await encodeSession({ m: {}, a: asha.id, v: asha.sessionVersion, t: today() });
  expect((await billCommand(g.id, a, bill.id, "pause", new Date("2026-11-20T06:00:00Z"))).ok).toBe(true);
  const part = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
  return { gid: g.id, a, r, billId: bill.id, part };
}

describe("a pause or stop charge is locked", () => {
  it("it was made: 114,000, 57,000 each; the books are Asha +57,000, Ravi −57,000", async () => {
    const w = await paused();
    expect(w.part.amount).toBe(114000);
    expect(w.part.shares.map((s) => s.amount).sort()).toEqual([57000, 57000]);
    const net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([57000, -57000]);
  });

  it("the real delete action refuses it, and nothing changes", async () => {
    const w = await paused();
    await redirected(() => A.deleteExpense(form({ groupId: w.gid, expenseId: w.part.id })));
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.part.id } })).deletedAt).toBeNull();
    const net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([57000, -57000]);
  });

  it("Activity's Undo of its creation refuses with the same words, through undoEvent and through the undo code itself", async () => {
    const w = await paused();
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, expenseId: w.part.id, kind: "expense_added" } });
    const viaEvent = await undoEvent(ev.id, w.a);
    expect(viaEvent.ok).toBe(false);
    const direct = await applyUndoPayload({ type: "expense_delete", expenseId: w.part.id }, w.gid, w.a, ev.text, { eventId: ev.id, actorId: w.a }, { actorId: ev.actorId, createdAt: ev.createdAt }, { recorderOk: true });
    expect(direct).toEqual({ ok: false, error: LOCKED });
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.part.id } })).deletedAt).toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: ev.id } })).undoneAt).toBeNull();
    await checkBooks(w.gid);
  });

  it("editing its amount (or who paid, or the split) is refused", async () => {
    const w = await paused();
    const noRate = async () => ({ ok: false as const, reason: "unavailable" as const, message: "no rate needed" });
    const base = { groupId: w.gid, expenseId: w.part.id, name: "Milk · 1–19 Nov", amount: "1140", currency: "INR", paidById: w.a, forMode: "everyone" as const, selected: [], onePersonId: "", splitType: "equal" as const, exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", category: "", rateMode: "auto" as const, manualRate: "" };
    expect(await saveExpense({ ...base, amount: "500" }, w.a, noRate)).toEqual({ ok: false, error: LOCKED });
    expect(await saveExpense({ ...base, paidById: w.r }, w.a, noRate)).toEqual({ ok: false, error: LOCKED });
    expect(await saveExpense({ ...base, forMode: "one" as const, onePersonId: w.a }, w.a, noRate)).toEqual({ ok: false, error: LOCKED });
    const after = await db.expense.findUniqueOrThrow({ where: { id: w.part.id }, include: { shares: true } });
    expect([after.amount, after.paidById]).toEqual([114000, w.a]);
    expect(after.shares.map((s) => s.amount).sort()).toEqual([57000, 57000]);
    await checkBooks(w.gid);
  });

  it("the words use the bill's name", () => {
    expect(chargeLockedText("Milk", "part")).toBe(LOCKED);
    expect(chargeLockedText("Rice", "part")).toContain("when Rice was paused or stopped");
  });

  it("a money-back expense is the way to put it right: Ravi gets ₹200 (20,000) back and shares it: Ravi owes Asha 10,000 more, so Asha +67,000, Ravi −67,000; paying 67,000 settles it to zero", async () => {
    const w = await paused();
    const noRate = async () => ({ ok: false as const, reason: "unavailable" as const, message: "no rate needed" });
    const r = await saveExpense({ groupId: w.gid, name: "Milk money back", amount: "200", currency: "INR", paidById: w.r, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", category: "", rateMode: "auto", manualRate: "", kind: "refund" }, w.r, noRate);
    expect(r.ok).toBe(true);
    let net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([67000, -67000]);
    await db.payment.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 67000, createdById: w.r } });
    net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([0, 0]);
  });

  it("erasing the group still removes it all", async () => {
    const w = await paused();
    await eraseGroups([w.gid]);
    expect(await db.expense.count({ where: { groupId: w.gid } })).toBe(0);
  });
});
