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
const { undoEvent } = await import("@/lib/undo");
const { moveOut } = await import("@/lib/home/moving-db");
const { runBillsForGroup } = await import("@/lib/home/bills-db");
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

  it("Activity's Undo of its creation refuses with the same words, through the real Undo action and undoEvent", async () => {
    const w = await paused();
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, expenseId: w.part.id, kind: "expense_added" } });
    await redirected(() => A.undoChange(form({ groupId: w.gid, eventId: ev.id, back: "group" })));
    expect(await undoEvent(ev.id, w.a)).toEqual({ ok: false, error: LOCKED });
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.part.id } })).deletedAt).toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: ev.id } })).undoneAt).toBeNull();
    await checkBooks(w.gid);
  });

  it("editing its amount (or who paid, or the split) is refused by the real add/edit action", async () => {
    const w = await paused();
    const base = { groupId: w.gid, expenseId: w.part.id, name: "Milk · 1–19 Nov", amount: "1140", currency: "INR", paidById: w.a, forMode: "everyone" as const, selected: [], onePersonId: "", splitType: "equal" as const, exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", category: "", rateMode: "auto" as const, manualRate: "" };
    expect((await A.addExpense({ ...base, amount: "500" })).error).toBe(LOCKED);
    expect((await A.addExpense({ ...base, paidById: w.r })).error).toBe(LOCKED);
    expect((await A.addExpense({ ...base, forMode: "one" as const, onePersonId: w.a })).error).toBe(LOCKED);
    const after = await db.expense.findUniqueOrThrow({ where: { id: w.part.id }, include: { shares: true } });
    expect([after.amount, after.paidById]).toEqual([114000, w.a]);
    expect(after.shares.map((x) => x.amount).sort()).toEqual([57000, 57000]);
    await checkBooks(w.gid);
  });

  it("the words use the bill's name", () => {
    expect(chargeLockedText("Milk", "part")).toBe(LOCKED);
    expect(chargeLockedText("Rice", "part")).toContain("when Rice was paused or stopped");
  });

  it("a money-back expense is the way to put it right: Ravi gets ₹200 (20,000) back and shares it: Asha +67,000, Ravi −67,000; Ravi pays ₹670 through the real payment action and everyone is at zero", async () => {
    const w = await paused();
    const r = await A.addExpense({ groupId: w.gid, name: "Milk money back", amount: "200", currency: "INR", paidById: w.r, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", category: "", rateMode: "auto", manualRate: "", kind: "refund" }).catch((e) => e);
    expect(String((r as Error)?.message ?? "")).toMatch(/NEXT_REDIRECT/); // saved: the action redirects to Activity
    let net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([67000, -67000]);
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: w.gid, fromId: w.r, toId: w.a, amount: "670" })));
    net = await checkBooks(w.gid);
    expect([net[w.a], net[w.r]]).toEqual([0, 0]);
  });

  it("erasing the group still removes it all", async () => {
    const w = await paused();
    await eraseGroups([w.gid]);
    expect(await db.expense.count({ where: { groupId: w.gid } })).toBe(0);
  });
});

// ---------- Where pause and stop charges meet move-outs and payers ----------
// Milk 6,000 a day, three flatmates with accounts: A (pays the bill), B, C. Everything is shared equally.
async function flat3() {
  const accs = await Promise.all(["a", "b", "c"].map((n) => db.account.create({ data: { email: `d3-${n}-${Math.random().toString(36).slice(2, 7)}-${stamp}@example.test`, name: n.toUpperCase() } })));
  accountIds.push(...accs.map((x) => x.id));
  const g = await db.group.create({
    data: {
      name: `D3 ${stamp}-${Math.random().toString(36).slice(2, 5)}`, type: "home", currency: "INR", inviteCode: `d3-${Math.random().toString(36).slice(2, 9)}-${stamp}`,
      members: { create: accs.map((x, i) => ({ name: x.name, accountId: x.id, createdAt: new Date(2026, 0, i + 1), claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const bill = await db.bill.create({ data: { groupId: g.id, name: "Milk", category: "groceries", nature: "daily", amount: 6000, startMonth: "2026-11", payer: id("A"), split: JSON.stringify({ mode: "equal" }), tz: "Asia/Kolkata" } });
  state.cookie = await encodeSession({ m: {}, a: accs[0].id, v: accs[0].sessionVersion, t: today() });
  return { gid: g.id, a: id("A"), b: id("B"), c: id("C"), billId: bill.id };
}
const day = (d: string) => new Date(`${d}T06:00:00Z`);
const live = (gid: string) => db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true }, orderBy: { createdAt: "asc" } });

describe("D1: a move-out can't be undone after a pause charge subtracted its charge", () => {
  it("C moves out 10 Nov (10 × 6,000 ÷ 3 = 20,000); pause 20 Nov adds 114,000 − 20,000 = 94,000 (47,000 each for A and B); undoing the move-out is refused, so the 20,000 isn't lost; books A +47,000, B −47,000, C 0", async () => {
    const f = await flat3();
    const out = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `d1-${stamp}-abcdefgh` }, day("2026-11-10"));
    expect(out).toMatchObject({ ok: true });
    expect((await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"))).ok).toBe(true);
    const part = (await live(f.gid)).find((e) => e.description.startsWith("Milk ·"))!;
    expect(part.amount).toBe(94000);
    const eventId = (out as { eventId?: string }).eventId!;
    const wanted = "Milk for this month was already added when it was paused or stopped, so this move-out can’t be undone. Add a money-back expense if needed.";
    await redirected(() => A.undoChange(form({ groupId: f.gid, eventId, back: "group" })));
    const r = await undoEvent(eventId, f.a);
    expect(r).toEqual({ ok: false, error: wanted });
    expect((await live(f.gid)).map((e) => e.amount).sort((x, y) => x - y)).toEqual([20000, 94000]);
    const net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([47000, -47000, 0]);
  });
});

describe("D2: a payer change before month end doesn't move a pause charge", () => {
  it("A pays the pause charge (114,000); the bill's payer becomes B; start again 25 Nov (20–24 not come); month end 36,000 is paid by B; the pause charge stays A's: A +64,000, B −14,000, C −50,000; then paying through the real action settles everyone", async () => {
    const f = await flat3();
    await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"));
    await db.bill.update({ where: { id: f.billId }, data: { payer: f.b } });
    await billCommand(f.gid, f.a, f.billId, "resume", day("2026-11-25"));
    await runBillsForGroup(f.gid, day("2026-12-01"));
    const list = await live(f.gid);
    const part = list.find((e) => e.description.startsWith("Milk ·"))!;
    const end = list.find((e) => e.description === "Milk")!;
    expect([part.paidById, part.amount]).toEqual([f.a, 114000]);
    expect([end.paidById, end.amount]).toEqual([f.b, 36000]);
    // Part: A +76,000, B −38,000, C −38,000. Month end: B +24,000, A −12,000, C −12,000.
    let net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([64000, -14000, -50000]);
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.gid, fromId: f.c, toId: f.a, amount: "500" })));
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.gid, fromId: f.b, toId: f.a, amount: "140" })));
    net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
  });
});

describe("D3: a move-out doesn't hand a pause charge to another payer", () => {
  it("A paid the pause charge (114,000); A moves out 22 Nov (B confirms): the charge is still paid by A, and the square-up pays A 38,000 from B and 38,000 from C", async () => {
    const f = await flat3();
    await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"));
    const part = (await live(f.gid))[0];
    const out = await moveOut(f.gid, f.b, { leaverId: f.a, lastDay: "2026-11-22", requestKey: `d3-${stamp}-abcdefgh` }, day("2026-11-22"));
    expect(out).toMatchObject({ ok: true });
    expect((await db.expense.findUniqueOrThrow({ where: { id: part.id } })).paidById).toBe(f.a);
    expect((out as { payments: { from: string; to: string; amount: number }[] }).payments.map((t) => [t.from, t.to, t.amount]).sort()).toEqual([[f.b, f.a, 38000], [f.c, f.a, 38000]].sort());
    const net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
  });
});

describe("D4: a move-out can't be dated before days a pause charge already covers", () => {
  it("paused 20 Nov (covers 1–19): a last day of 15 Nov is refused with the day to pick; 19 Nov works and C leaves at 0", async () => {
    const f = await flat3();
    await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"));
    const early = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-15", addDaily: true, requestKey: `d4a-${stamp}-abcdefgh` }, day("2026-11-21"));
    expect(early).toEqual({ ok: false, error: "Milk was already added up to 19 Nov when it was paused, so the last day can’t be before that. Pick 19 Nov or later, or add a money-back expense." });
    const ok = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-19", addDaily: true, requestKey: `d4b-${stamp}-abcdefgh` }, day("2026-11-21"));
    expect(ok).toMatchObject({ ok: true });
    const net = await checkBooks(f.gid);
    expect(net[f.c]).toBe(0);
  });
});

describe("D6: the month-end note says which days each part charge covered", () => {
  it("pause 20 (1–19), start again 25, pause 28 (25–27 → from the day after the first: 20–27), start again 29; the month-end note lists ₹1,140 for 1–19 Nov and ₹180 for 20–27 Nov", async () => {
    const f = await flat3();
    for (const [c, d] of [["pause", "2026-11-20"], ["resume", "2026-11-25"], ["pause", "2026-11-28"], ["resume", "2026-11-29"]] as const) expect((await billCommand(f.gid, f.a, f.billId, c, day(d))).ok).toBe(true);
    await runBillsForGroup(f.gid, day("2026-12-01"));
    const end = (await live(f.gid)).find((e) => e.description === "Milk")!;
    expect(end.notes).toContain("less ₹1,140 already added for 1–19 Nov");
    expect(end.notes).toContain("less ₹180 already added for 20–27 Nov");
    await checkBooks(f.gid);
  });
});
