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
const B = await import("@/app/bill-actions");
const { billCommand } = await import("@/lib/home/bill-setup");
const { undoEvent } = await import("@/lib/undo");
const { moveOut, moveOutPreview } = await import("@/lib/home/moving-db");
const { runBillsForGroup, billChangeLines } = await import("@/lib/home/bills-db");
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

const MOVED = "Someone moved out this month, so Milk can’t be paused or stopped until next month. Mark the days it didn’t come instead.";
const noMoveOut = (up: string, mon = "Nov") => `Milk was already added up to ${up} ${mon} when it was paused or stopped, so a move-out can’t be recorded for this month. Add a money-back expense if needed.`;
const noUndo = "Milk for this month was already added when it was paused or stopped, so this move-out can’t be undone. Add a money-back expense if needed.";
const netOf = async (f: { gid: string; a: string; b: string; c: string }) => {
  const n = await checkBooks(f.gid);
  return [n[f.a], n[f.b], n[f.c]];
};

describe("Rule 1: a daily bill can't be paused or stopped in a month someone moved out (E1, E4)", () => {
  it("C moves out 20 Nov with the daily charge (20 × 6,000 ÷ 3 = 40,000, squared up); pausing on 20 Nov is refused, then so is stopping; the charge stays with A; books A 0, B 0, C 0, unchanged", async () => {
    const f = await flat3();
    const out = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-20", addDaily: true, requestKey: `r1a-${stamp}-abcdefgh` }, day("2026-11-20"));
    expect(out).toMatchObject({ ok: true });
    expect(await netOf(f)).toEqual([0, 0, 0]);
    expect(await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"))).toEqual({ ok: false, error: MOVED });
    expect(await billCommand(f.gid, f.a, f.billId, "stop", day("2026-11-20"))).toEqual({ ok: false, error: MOVED });
    const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
    expect([bill.paused, bill.deletedAt]).toEqual([false, null]);
    const list = await live(f.gid);
    expect(list.map((e) => [e.amount, e.paidById])).toEqual([[40000, f.a]]);
    expect(await netOf(f)).toEqual([0, 0, 0]);
  });

  it("a move-out with no charge at all (not asked for) blocks it too; the confirm shows the same words as the refusal; resuming is not affected by it", async () => {
    const f = await flat3();
    expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-10", requestKey: `r1b-${stamp}-abcdefgh` }, day("2026-11-10"))).toMatchObject({ ok: true });
    const lines = await billChangeLines(f.billId, day("2026-11-20"));
    expect(lines?.refused).toBe(MOVED);
    expect(lines?.stop).toEqual({ amount: 0, line: MOVED });
    expect(await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"))).toEqual({ ok: false, error: MOVED });
    expect(await live(f.gid)).toHaveLength(0);
    expect(await netOf(f)).toEqual([0, 0, 0]);
  });

  it("the real change-bill action refuses it too (the clock is fixed at 20 Nov 2026 for this test): nothing is paused or added", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    try {
      const f = await flat3();
      expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-20", requestKey: `r1c-${stamp}-abcdefgh` }, new Date())).toMatchObject({ ok: true });
      await redirected(() => B.changeBill(form({ groupId: f.gid, billId: f.billId, command: "pause" })));
      await redirected(() => B.changeBill(form({ groupId: f.gid, billId: f.billId, command: "stop" })));
      const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
      expect([bill.paused, bill.deletedAt]).toEqual([false, null]);
      expect(await live(f.gid)).toHaveLength(0);
      expect(await netOf(f)).toEqual([0, 0, 0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pausing next month after a move-out works: C moves out 28 Nov (28 × 6,000 ÷ 3 = 56,000, squared up); pausing 5 Dec adds Nov's rest 180,000 − 56,000 = 124,000 (62,000 each for A and B) and Dec 1–4 = 24,000 (12,000 each); A +74,000, B −74,000, C 0, then B pays A through the real action", async () => {
    const f = await flat3();
    expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-28", addDaily: true, requestKey: `r1d-${stamp}-abcdefgh` }, day("2026-11-28"))).toMatchObject({ ok: true });
    expect((await billCommand(f.gid, f.a, f.billId, "pause", day("2026-12-05"))).ok).toBe(true);
    expect((await live(f.gid)).map((e) => e.amount).sort((x, y) => x - y)).toEqual([24000, 56000, 124000]);
    expect(await netOf(f)).toEqual([74000, -74000, 0]);
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.gid, fromId: f.b, toId: f.a, amount: "740" })));
    expect(await netOf(f)).toEqual([0, 0, 0]);
  });
});

describe("Rule 2: a move-out is refused for a month with a pause or stop charge, or any later month (E2, E3, E5)", () => {
  it("E5: paused 20 Nov (114,000, 38,000 each; A +76,000, B −38,000, C −38,000): C can't move out, with or without the daily charge, in the preview or for real; C stays, books unchanged", async () => {
    const f = await flat3();
    await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"));
    for (const [k, lastDay, addDaily] of [["x1", "2026-11-19", false], ["x2", "2026-11-19", true], ["x3", "2026-11-15", true], ["x4", "2026-11-20", false]] as const) {
      const r = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay, addDaily, requestKey: `r2a-${k}-${stamp}-abcdefgh` }, day("2026-11-21"));
      expect(r).toEqual({ ok: false, error: noMoveOut("19") });
    }
    expect(await moveOutPreview(f.gid, f.c, "2026-11-15", day("2026-11-21"), f.a)).toEqual({ ok: false, error: noMoveOut("19") });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    expect(await netOf(f)).toEqual([76000, -38000, -38000]);
  });

  it("E2: the bill was stopped 20 Nov (it is gone, its charge stays): a move-out is still refused, naming the stopped bill; books A +76,000, B −38,000, C −38,000, then both pay A through the real action and all are 0", async () => {
    const f = await flat3();
    expect((await billCommand(f.gid, f.a, f.billId, "stop", day("2026-11-20"))).ok).toBe(true);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).not.toBeNull();
    const r = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-25", addDaily: true, requestKey: `r2b-${stamp}-abcdefgh` }, day("2026-11-26"));
    expect(r).toEqual({ ok: false, error: noMoveOut("19") });
    expect(await netOf(f)).toEqual([76000, -38000, -38000]);
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.gid, fromId: f.b, toId: f.a, amount: "380" })));
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.gid, fromId: f.c, toId: f.a, amount: "380" })));
    expect(await netOf(f)).toEqual([0, 0, 0]);
  });

  it("E3: paused 5 Dec (Nov's 180,000 and Dec 1–4 = 24,000 added; A +136,000, B −68,000, C −68,000): a move-out with last day 28 Nov is refused, because December has a pause charge; books unchanged", async () => {
    const f = await flat3();
    expect((await billCommand(f.gid, f.a, f.billId, "pause", day("2026-12-05"))).ok).toBe(true);
    const r = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-28", addDaily: true, requestKey: `r2c-${stamp}-abcdefgh` }, day("2026-12-05"));
    expect(r).toEqual({ ok: false, error: noMoveOut("4", "Dec") });
    expect(await moveOutPreview(f.gid, f.c, "2026-11-28", day("2026-12-05"), f.a)).toEqual({ ok: false, error: noMoveOut("4", "Dec") });
    expect(await netOf(f)).toEqual([136000, -68000, -68000]);
  });

  it("a move-out in a month after the pause charge's month is fine: paused 20 Nov (A +76,000, B −38,000, C −38,000), C moves out 2 Dec: C pays 38,000 in the square-up and leaves at 0", async () => {
    const f = await flat3();
    await billCommand(f.gid, f.a, f.billId, "pause", day("2026-11-20"));
    const r = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-12-02", requestKey: `r2d-${stamp}-abcdefgh` }, day("2026-12-02"));
    expect(r).toMatchObject({ ok: true });
    expect(await netOf(f)).toEqual([38000, -38000, 0]); // C paid A 38,000; B still owes A
  });
});

describe("Rule 3: a move-out can't be undone once a pause or stop charge was written after it (E1)", () => {
  it.each(["pause", "stop"])("C moves out 28 Nov (56,000), then the bill is %s on 5 Dec: undoing the move-out is refused in the real Undo action and undoEvent; C stays gone, the charge stays, books A +74,000, B −74,000, C 0", async (command) => {
    const f = await flat3();
    const out = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-28", addDaily: true, requestKey: `r3-${command}-${stamp}-abcdefgh` }, day("2026-11-28"));
    expect(out).toMatchObject({ ok: true });
    expect((await billCommand(f.gid, f.a, f.billId, command, day("2026-12-05"))).ok).toBe(true);
    const eventId = (out as { eventId: string }).eventId;
    await redirected(() => A.undoChange(form({ groupId: f.gid, eventId, back: "group" })));
    expect(await undoEvent(eventId, f.a)).toEqual({ ok: false, error: noUndo });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).not.toBeNull();
    expect((await live(f.gid)).map((e) => e.amount).sort((x, y) => x - y)).toEqual([24000, 56000, 124000]);
    expect(await netOf(f)).toEqual([74000, -74000, 0]);
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

describe("D6: the month-end note says which days each part charge covered", () => {
  it("pause 20 (1–19), start again 25, pause 28 (25–27 → from the day after the first: 20–27), start again 29; the month-end note lists ₹1,140 for 1–19 Nov and ₹180 for 20–27 Nov", async () => {
    const f = await flat3();
    for (const [c, d] of [["pause", "2026-11-20"], ["resume", "2026-11-25"], ["pause", "2026-11-28"], ["resume", "2026-11-29"]] as const) expect((await billCommand(f.gid, f.a, f.billId, c, day(d))).ok).toBe(true);
    await runBillsForGroup(f.gid, day("2026-12-01"));
    const end = (await live(f.gid)).find((e) => e.description === "Milk")!;
    expect(end.notes).toContain("less ₹1,140 already added for 1–19 Nov");
    expect(end.notes).toContain("less ₹180 already added for 20–27 Nov");
    // One label for each part charge, in its name and in the note.
    expect((await live(f.gid)).map((e) => e.description).filter((n) => n.startsWith("Milk ·")).sort()).toEqual(["Milk · 1–19 Nov", "Milk · 20–27 Nov"]);
    await checkBooks(f.gid);
  });
});
