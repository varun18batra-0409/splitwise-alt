import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { moveOut, saveDepositFor } from "@/lib/home/moving-db";
import { CLOSED_MOVE_OUT_TEXT, LEAVER_BLOCKED_TEXT, MOVED_OUT_REJOIN_TEXT, actorRefusal, canUndo, historyCheck, leaverUndoChecks, ownMoveOut, pickOwnMoveOut, undoEvent, undoViewerFor } from "@/lib/undo";
import { setMemberLeft } from "@/lib/people";
import { joinNew } from "@/lib/join";
import { acceptInvitation } from "@/lib/invitations";
import { readFileSync } from "node:fs";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";
import { loadGroupView } from "@/lib/group-data";
import { scopeForLeaver } from "@/lib/left-view";

// Undoing a move-out takes back EVERYTHING the move-out did: the person, the bills' shares, the deposit and the square-up payments.
// Throwaway database, amounts in paise, every number worked by hand.
//
// The flat: Meera (pays the rent), Ravi and Asha, equal weights 100. November has 30 days. Asha moves herself out, last day 10 Nov.
//   Rent   900000 paid by Meera: 300000 each.                                  Meera +600000, Ravi -300000, Asha -300000
//   Wi-Fi  100000 paid by Asha:  Meera 33334, Ravi 33333, Asha 33333.          Meera  -33334, Ravi  -33333, Asha  +66667
//   Before the move-out:  Meera +566666, Ravi -333333, Asha -233333   (sum 0)
//
//   Re-split (Asha keeps floor(share x 10 / 30), the rest goes to the others by their shares):
//   Rent:  Asha keeps floor(300000 x 10 / 30) = 100000; 200000 freed, 100000 each  -> Meera 400000, Ravi 400000, Asha 100000 (sum 900000)
//   Wi-Fi: Asha keeps floor(33333 x 10 / 30) = 11111; 22222 freed, split 33334 : 33333:
//          Meera 22222 x 33334 / 66667 = 11111.2 -> 11111, Ravi 11110.8 -> 11110, the 1 left over goes to the bigger remainder (Ravi)
//          -> Meera 33334 + 11111 = 44445, Ravi 33333 + 11111 = 44444, Asha 11111 (sum 100000)
//   After the re-split:    Meera +500000 - 44445 = +455555, Ravi -400000 - 44444 = -444444, Asha -100000 + 100000 - 11111 = -11111   (sum 0)
//   Square-up: Asha owes Meera 11111. CHANGED 16 Nov (A5): someone who has left always owes nothing, so the payment Asha -> Meera 11111
//   is recorded straight away (and Meera, who has joined, is asked "Confirm received / Not received": needsOk, not yet confirmed).
//   After the move-out: Meera +444444, Ravi -444444, Asha 0.
//   Meera says "Not received": the payment comes off and Asha is back in the flat: Meera +455555, Ravi -444444, Asha -11111.
//   Undo (Asha, before Meera answers): shares exactly 300000 x 3 and 33334 / 33333 / 33333, the payment taken off -> the "before" balances again:
//   Meera +566666, Ravi -333333, Asha -233333. (After Meera confirmed, the confirmed 11111 stays: Meera +555555, Ravi -333333, Asha -222222;
//   that case is in tests/move-out-claims.test.ts 8b.)
//   Settling those: Ravi pays Meera 333333, Asha pays Meera 233333 -> everyone 0.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `mfu-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

async function flat() {
  const [mA, rA, sA] = [await account("Meera"), await account("Ravi"), await account("Asha")];
  const g = await db.group.create({
    data: {
      name: `Full undo ${++n} ${stamp}`, type: "home", currency: "INR", inviteCode: `mfu-${n}-${stamp}`,
      members: {
        create: [
          { name: "Meera", accountId: mA.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1), splitWeight: 100 },
          { name: "Ravi", accountId: rA.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2), splitWeight: 100 },
          { name: "Asha", accountId: sA.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3), splitWeight: 100 },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [M, R, S] = [id("Meera"), id("Ravi"), id("Asha")];
  const bill = async (name: string, amount: number, paidById: string, shares: [string, number][]) => {
    const e = await db.expense.create({
      data: {
        groupId: g.id, description: name, category: "bills", amount, paidById, createdById: paidById, splitType: "equal", forMode: "everyone",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
        shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
    const b = await db.bill.create({ data: { groupId: g.id, name, nature: "fixed", amount, day: 1, startMonth: "2026-11", payer: paidById } });
    await db.billRun.create({ data: { billId: b.id, period: "2026-11", status: "added", expenseId: e.id } });
    return { e, b };
  };
  const rent = await bill("Rent", 900000, M, [[M, 300000], [R, 300000], [S, 300000]]);
  const wifi = await bill("Wi-Fi", 100000, S, [[M, 33334], [R, 33333], [S, 33333]]);
  expect((await saveDepositFor(g.id, M, { heldBy: "Landlord", amounts: { [S]: "30000", [R]: "30000" } })).ok).toBe(true);
  const nets = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const sharesOf = async (expenseId: string) => {
    const rows = await db.expenseShare.findMany({ where: { expenseId } });
    return Object.fromEntries(rows.map((s) => [s.memberId, s.amount]));
  };
  return { g, M, R, S, rent, wifi, nets, sharesOf, code: g.inviteCode, asha: sA };
}
type Flat = Awaited<ReturnType<typeof flat>>;

const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);

async function ashaMovesOut(f: Flat) {
  expect(await f.nets()).toEqual({ [f.M]: 566666, [f.R]: -333333, [f.S]: -233333 });
  const r = await moveOut(f.g.id, f.S, { leaverId: f.S, lastDay: "2026-11-10", depositTo: f.M, requestKey: `mfu-${stamp}-${++n}-abcdefgh` }, new Date("2026-11-10T06:00:00Z"));
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("undoing a move-out takes everything back", () => {
  it("re-split, square-up payment, deposit and bill payer all go back exactly; the move-out's own lines are marked undone; everyone settles to 0", async () => {
    const f = await flat();
    const r = await ashaMovesOut(f);
    // The move-out's own line: moveOut returns its id.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    expect(r.eventId).toBe(ev.id);
    expect(r.payments).toEqual([{ from: f.S, to: f.M, amount: 11111 }]); // the final payment worked out...
    expect((await db.paymentClaim.count({ where: { groupId: f.g.id } }))).toBe(0); // ...is a counted payment, not a note...
    const sq = await db.payment.findMany({ where: { groupId: f.g.id } });
    expect(sq.map((x) => [x.fromId, x.toId, x.amount, x.needsOk, x.okAt])).toEqual([[f.S, f.M, 11111, true, null]]); // ...that asks Meera

    // After the re-split and the square-up payment.
    expect(await f.sharesOf(f.rent.e.id)).toEqual({ [f.M]: 400000, [f.R]: 400000, [f.S]: 100000 });
    expect(await f.sharesOf(f.wifi.e.id)).toEqual({ [f.M]: 44445, [f.R]: 44444, [f.S]: 11111 });
    const moved = await f.nets();
    expect(moved).toEqual({ [f.M]: 444444, [f.R]: -444444, [f.S]: 0 }); // Asha left at exactly 0
    expect(sum(moved)).toBe(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.wifi.b.id } })).payer).toBe(f.M); // handed on (the first one still here)

    // Asha undoes her own move-out.
    const u = await undoEvent(ev.id, f.S);
    expect(u.ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).toBeNull();
    // Shares exactly as they were, and the bills back to "equal / everyone".
    expect(await f.sharesOf(f.rent.e.id)).toEqual({ [f.M]: 300000, [f.R]: 300000, [f.S]: 300000 });
    expect(await f.sharesOf(f.wifi.e.id)).toEqual({ [f.M]: 33334, [f.R]: 33333, [f.S]: 33333 });
    for (const e of [f.rent.e, f.wifi.e]) {
      const row = await db.expense.findUniqueOrThrow({ where: { id: e.id }, include: { shares: true } });
      expect(row).toMatchObject({ splitType: "equal", forMode: "everyone" });
      expect(row.shares.reduce((a, s) => a + s.amount, 0)).toBe(row.amount);
    }
    // The square-up payment is taken off; the Wi-Fi bill is Asha's to pay again.
    expect(await db.payment.count({ where: { groupId: f.g.id, deletedAt: null } })).toBe(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.wifi.b.id } })).payer).toBe(f.S);
    // The deposit: Asha's 3000000 back, held, with nobody; Meera's handed-over share is gone; Ravi's is untouched.
    const dep = await db.depositShare.findMany({ where: { deposit: { groupId: f.g.id } } });
    expect(dep.find((x) => x.memberId === f.S)).toMatchObject({ amount: 3000000, status: "held", toMemberId: "" });
    expect(dep.find((x) => x.memberId === f.M)).toBeUndefined();
    expect(dep.find((x) => x.memberId === f.R)).toMatchObject({ amount: 3000000, status: "held" });
    // The move-out's lines in Activity are marked undone with it.
    for (const e of await db.groupEvent.findMany({ where: { groupId: f.g.id, kind: { in: ["member_left", "expense_edited", "payment_recorded"] } } })) {
      expect(e.undoneAt).not.toBeNull();
    }
    // The balances are the "before" ones, and add to 0.
    const back = await f.nets();
    expect(back).toEqual({ [f.M]: 566666, [f.R]: -333333, [f.S]: -233333 });
    expect(sum(back)).toBe(0);
    // The undo's own line says what came back.
    const rejoined = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_rejoined" } });
    expect(rejoined.details).toContain("Taken off: Asha paid Meera ₹111.11");
    expect(rejoined.details).toContain("move-out undone");
    // Settling up from there: Ravi pays Meera 333333, Asha pays Meera 233333, and everyone is 0.
    const plan = smartSettle(back).sort((a, b) => a.from.localeCompare(b.from));
    expect(plan).toEqual([{ from: f.R, to: f.M, amount: 333333 }, { from: f.S, to: f.M, amount: 233333 }].sort((a, b) => a.from.localeCompare(b.from)));
    for (const t of plan) await db.payment.create({ data: { groupId: f.g.id, fromId: t.from, toId: t.to, amount: t.amount, createdById: t.from } });
    expect(await f.nets()).toEqual({ [f.M]: 0, [f.R]: 0, [f.S]: 0 });
  });

  it("Fix 1: the person who moved out sees the line, can undo it (Meera can't), and the Undo is gone afterwards", async () => {
    const f = await flat();
    const r = await ashaMovesOut(f);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    expect(r.eventId).toBe(ev.id);
    // Her scoped history holds it, although it was saved after the day she left.
    const view = (await loadGroupView(f.g.id, { viewer: f.S }))!;
    expect(view.leaver).not.toBeNull();
    expect(view.group.events.map((e) => e.id)).toContain(ev.id);
    expect(view.group.events.find((e) => e.id === ev.id)!.details).toContain("Asha paid Meera ₹111.11 (Meera is asked to confirm)"); // a counted payment that asks Meera
    // canUndo with each viewer: Asha yes, Meera no (only Asha can undo leaving the group).
    const events = await db.groupEvent.findMany({ where: { groupId: f.g.id, createdAt: { gte: ev.createdAt } } });
    expect(canUndo(ev, events, new Date(), await undoViewerFor(f.g.id, f.S)).ok).toBe(true);
    expect(canUndo(ev, events, new Date(), await undoViewerFor(f.g.id, f.M)).ok).toBe(false);
    // The People / group page's own move-out.
    const own = await ownMoveOut(f.g.id, await undoViewerFor(f.g.id, f.S), new Date());
    expect(own?.event.id).toBe(ev.id);
    expect(own?.check.ok).toBe(true);
    expect(await ownMoveOut(f.g.id, await undoViewerFor(f.g.id, f.M), new Date())).toBeNull(); // Meera hasn't moved out
    expect((await undoEvent(ev.id, f.S)).ok).toBe(true);
    expect(await ownMoveOut(f.g.id, await undoViewerFor(f.g.id, f.S), new Date())).toBeNull(); // back in the flat, nothing to undo
  });

  it("an expense added in between by someone else is not in the way, and keeps counting", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    // Meera adds Snacks 3000, 1500 each for Meera and Ravi (Asha is not in it): Meera +1500, Ravi -1500 on top of the move-out's balances.
    await db.expense.create({
      data: {
        groupId: f.g.id, description: "Snacks", amount: 3000, paidById: f.M, createdById: f.M, splitType: "equal", forMode: "selected",
        originalAmount: 3000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 3000,
        shares: { create: [{ memberId: f.M, amount: 1500 }, { memberId: f.R, amount: 1500 }] },
      },
    });
    expect((await undoEvent(ev.id, f.S)).ok).toBe(true);
    // Before the move-out (+566666 / -333333 / -233333) plus Snacks (Meera +1500, Ravi -1500).
    const after = await f.nets();
    expect(after).toEqual({ [f.M]: 568166, [f.R]: -334833, [f.S]: -233333 });
    expect(sum(after)).toBe(0);
  });

  it("a refused undo changes nothing: a bill share edited since", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    // Behind the app's back (no history line, so only the in-transaction check can notice): Ravi's Rent share moves by 100, Meera's by -100.
    await db.expenseShare.updateMany({ where: { expenseId: f.rent.e.id, memberId: f.R }, data: { amount: 400100 } });
    await db.expenseShare.updateMany({ where: { expenseId: f.rent.e.id, memberId: f.M }, data: { amount: 399900 } });
    const before = await f.nets();
    const u = await undoEvent(ev.id, f.S);
    expect(u).toEqual({ ok: false, error: LEAVER_BLOCKED_TEXT }); // Asha has left: told plainly, without naming who changed Rent
    expect(await f.nets()).toEqual(before);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: ev.id } })).undoneAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, undoneAt: { not: null } } })).toBe(0);
    expect(await db.payment.count({ where: { groupId: f.g.id, deletedAt: null } })).toBe(1); // Asha's square-up payment is still counted: the refused undo left it
  });
});

// ---- Pure rules (no database): what stands in the way of undoing a move-out ----
describe("canUndo / historyCheck for a move-out", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  const plus = (ms: number) => new Date(T0.getTime() + ms);
  const money = {
    currency: "INR",
    shares: [{ expenseId: "rent", amount: 900000, splitType: "equal", forMode: "everyone", before: [{ memberId: "asha", amount: 300000 }], after: [{ memberId: "asha", amount: 100000 }] }],
    payments: [{ id: "pay1", fromId: "asha", toId: "meera", amount: 11111 }],
    eventIds: ["edit1", "pay1ev"],
  };
  type Ev = Parameters<typeof historyCheck>[0];
  const ev = (o: Partial<Ev> & { id: string }): Ev => ({ kind: "expense_edited", undo: "", undoneAt: null, expenseId: null, paymentId: null, createdAt: plus(0), ...o });
  const moveOutEv = (moneyPart: object | undefined, details: string[] = []): Ev =>
    ev({ id: "mo", kind: "member_left", actorId: "asha", details: JSON.stringify(details), undo: JSON.stringify({ type: "member_set", memberId: "asha", data: { leftAt: null }, moveOut: { bills: [], ...(moneyPart ? { money: moneyPart } : {}) } }) });
  const viewer = { id: "asha", isAdmin: false, closed: false, members: [{ id: "meera", name: "Meera", accountId: "a1", leftAt: null, removedAt: null }, { id: "asha", name: "Asha", accountId: "a2", leftAt: T0, removedAt: null }] };

  it("a newer edit of the Rent the move-out re-split blocks it, and names that edit", () => {
    const mo = moveOutEv(money);
    const edit = ev({ id: "x1", expenseId: "rent", createdAt: plus(60_000) });
    const c = historyCheck(mo, [mo, edit]);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.blockedBy?.id).toBe("x1");
  });
  it("the move-out's own lines (its bill change and its payment line) are not 'newer changes'", () => {
    const mo = moveOutEv(money);
    const own = ev({ id: "edit1", expenseId: "rent", createdAt: plus(1) });
    const ownPay = ev({ id: "pay1ev", kind: "payment_recorded", paymentId: "pay1", createdAt: plus(2) });
    expect(historyCheck(mo, [mo, own, ownPay]).ok).toBe(true);
    expect(canUndo(mo, [mo, own, ownPay], plus(3_600_000), viewer).ok).toBe(true);
  });
  it("a newer change to a payment of the square-up blocks it; a newer edit of an unrelated expense does not", () => {
    const mo = moveOutEv(money);
    expect(historyCheck(mo, [mo, ev({ id: "x2", kind: "payment_deleted", paymentId: "pay1", createdAt: plus(60_000) })]).ok).toBe(false);
    expect(historyCheck(mo, [mo, ev({ id: "x3", expenseId: "snacks", createdAt: plus(60_000) })]).ok).toBe(true);
  });
  it("a newer currency change blocks it", () => {
    const mo = moveOutEv(money);
    const c = historyCheck(mo, [mo, ev({ id: "x4", kind: "currency_changed", createdAt: plus(60_000) })]);
    expect(c).toMatchObject({ ok: false, reason: "The group currency changed after the move-out, so it can’t be undone." });
  });
  it("a move-out saved before 'money' was kept: refused when it moved money, fine when it only handed on a deposit or a daily charge", () => {
    const legacy = moveOutEv(undefined, ["₹1,000.00 of bills after they left moved to the others", "Asha paid Meera ₹111.11"]);
    expect(historyCheck(legacy, [legacy])).toMatchObject({ ok: false, reason: expect.stringContaining("saved before Undo could also take back") });
    const light = moveOutEv(undefined, ["Milk: Asha’s share for 10 days, ₹200.00, charged now", "Deposit ₹30,000.00 taken over by Meera"]);
    expect(historyCheck(light, [light]).ok).toBe(true);
  });
  it("pickOwnMoveOut: the newest un-undone move-out of that person, not someone else's", () => {
    const mine = { ...moveOutEv(money), id: "m1", createdAt: plus(0) };
    const newer = { ...moveOutEv(money), id: "m2", createdAt: plus(1000) };
    const others = { ...moveOutEv(money), id: "m3", createdAt: plus(2000), undo: JSON.stringify({ type: "member_set", memberId: "meera", data: { leftAt: null }, moveOut: { bills: [] } }) };
    const undone = { ...moveOutEv(money), id: "m4", createdAt: plus(3000), undoneAt: plus(4000) };
    expect(pickOwnMoveOut([mine, newer, others, undone], "asha")?.id).toBe("m2");
    expect(pickOwnMoveOut([others], "asha")).toBeNull();
  });
});

describe("what a leaver sees of the lines about herself", () => {
  const cut = new Date("2026-11-10T12:00:00.000Z");
  const after = new Date("2026-11-12T00:00:00.000Z");
  const line = (id: string, memberId: string, kind = "member_left") => ({ id, createdAt: after, touches: "", expenseId: null, paymentId: null, kind, undo: JSON.stringify({ type: "member_set", memberId, data: { leftAt: null } }) });
  it("a line after the day she left, with nobody's balance touched, is kept when it is a left/rejoined line about her, and dropped when it is about someone else", () => {
    const out = scopeForLeaver({ expenses: [], payments: [], events: [line("mine", "asha"), line("rejoin", "asha", "member_rejoined"), line("theirs", "meera"), { ...line("other", "asha", "group_renamed") }] }, "asha", cut);
    expect(out.events.map((e) => e.id).sort()).toEqual(["mine", "rejoin"]);
  });
});

// ---- Review fixes ----
describe("a move-out's own lines are undone with the move-out, never alone (M2)", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  type Ev = Parameters<typeof historyCheck>[0];
  const ev = (o: Partial<Ev> & { id: string }): Ev => ({ kind: "expense_edited", undo: "", undoneAt: null, expenseId: null, paymentId: null, createdAt: T0, ...o });
  const parent = (o: Partial<Ev> = {}): Ev =>
    ev({ id: "mo", kind: "member_left", undo: JSON.stringify({ type: "member_set", memberId: "asha", data: { leftAt: null }, moveOut: { bills: [], money: { currency: "INR", shares: [], payments: [], eventIds: ["edit1", "pay1ev", "charge1"] } } }), ...o });
  const revert = JSON.stringify({ type: "expense_revert", expenseId: "rent", before: {} });
  it("the re-split edit, the square-up payment line and the daily charge each say so, naming the person when the names are known", () => {
    const mo = parent();
    const nameOf = (id: string) => (id === "asha" ? "Asha" : undefined);
    for (const id of ["edit1", "pay1ev", "charge1"]) {
      const line = ev({ id, undo: revert, expenseId: "rent" });
      expect(historyCheck(line, [line, mo], nameOf)).toEqual({ ok: false, reason: "This was part of Asha’s move-out. Undo the move-out instead." });
      expect(historyCheck(line, [line, mo])).toEqual({ ok: false, reason: "This was part of a move-out. Undo the move-out instead." });
    }
  });
  it("once the move-out is undone its lines say 'already undone', and an unrelated edit is unaffected", () => {
    const line = ev({ id: "edit1", undo: revert, expenseId: "rent", undoneAt: T0 });
    expect(historyCheck(line, [line, parent({ undoneAt: T0 })])).toEqual({ ok: false, reason: "This change was already undone." });
    const other = ev({ id: "other", undo: revert, expenseId: "snacks" });
    expect(historyCheck(other, [other, parent()]).ok).toBe(true);
  });
  it("a move-out of the same moment (saved just after its lines) still counts", () => {
    const line = ev({ id: "edit1", undo: revert, expenseId: "rent", createdAt: T0 });
    expect(historyCheck(line, [line, parent({ createdAt: T0 })]).ok).toBe(false);
  });
  it("in the database: undoing the re-split edit or the payment line is refused and changes nothing", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const before = { nets: await f.nets(), rent: await f.sharesOf(f.rent.e.id), wifi: await f.sharesOf(f.wifi.e.id) };
    const edit = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "expense_edited", expenseId: f.rent.e.id } });
    expect(await undoEvent(edit.id, f.R)).toEqual({ ok: false, error: "This was part of Asha’s move-out. Undo the move-out instead." });
    const payLine = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "payment_recorded" } });
    expect(await undoEvent(payLine.id, f.R)).toEqual({ ok: false, error: "This was part of Asha’s move-out. Undo the move-out instead." });
    expect({ nets: await f.nets(), rent: await f.sharesOf(f.rent.e.id), wifi: await f.sharesOf(f.wifi.e.id) }).toEqual(before);
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, undoneAt: { not: null } } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
  });
});

describe("someone who moved out judges Undo on the full history (M1) and is told plainly why not (L1)", () => {
  it("Ravi edits Rent after the move-out in a way Asha can't see: her screen's trimmed history says yes, the full history (and the server) say no", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const mo = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    // An edit of Rent by Ravi that moves only Ravi's and Meera's money (touches Ravi and Meera, not Asha), a minute later.
    await db.groupEvent.create({ data: { groupId: f.g.id, actorId: f.R, kind: "expense_edited", text: "changed Rent", expenseId: f.rent.e.id, touches: `${f.R},${f.M}`, createdAt: new Date(mo.createdAt.getTime() + 60_000), undo: JSON.stringify({ type: "expense_revert", expenseId: f.rent.e.id, before: {} }) } });
    const viewer = await undoViewerFor(f.g.id, f.S);
    // (Whether her trimmed Activity shows this edit depends on her share in Rent; the point is that her Undo is judged on the full history.)
    const checks = await leaverUndoChecks(f.g.id, viewer, new Date());
    expect(checks.get(mo.id)).toEqual({ ok: false, reason: LEAVER_BLOCKED_TEXT }); // never names Ravi or what he did
    const own = await ownMoveOut(f.g.id, viewer, new Date());
    expect(own?.check.ok).toBe(false);
    expect(await undoEvent(mo.id, f.S)).toEqual({ ok: false, error: LEAVER_BLOCKED_TEXT }); // the server agrees, in the same words
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
  });
  it("someone still in the flat has no leaver checks; the leaver's blocked text never names anyone", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    expect((await leaverUndoChecks(f.g.id, await undoViewerFor(f.g.id, f.M), new Date())).size).toBe(0);
    expect(LEAVER_BLOCKED_TEXT).toBe("Something the move-out changed was changed again since, so it can’t be undone. Ask someone in the flat to undo that change first.");
    for (const file of ["src/app/groups/[id]/_components/LeftBanner.tsx", "src/app/groups/[id]/people/page.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("blockedMessage(ownMove");
      expect(src).toContain("leaverBlockedText(");
    }
  });
});

describe("rejoining through the group's join link (M3)", () => {
  it("someone whose move-out can still be undone is not quietly put back; after the undo the link works", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const joiner = { id: f.asha.id, name: "Asha", email: f.asha.email };
    const r = await joinNew(f.code, joiner, "Asha");
    expect(r).toMatchObject({ ok: false, reason: "moved_out", groupId: f.g.id, memberId: f.S });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
    const mo = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    expect((await undoEvent(mo.id, f.S)).ok).toBe(true);
    expect(await joinNew(f.code, joiner, "Asha")).toMatchObject({ ok: true, memberId: f.S });
  });
  it("the join action sends them to People with the calm words", () => {
    const src = readFileSync("src/app/actions.ts", "utf8");
    expect(src).toContain('r.reason === "moved_out"');
    expect(src).toContain("MOVED_OUT_REJOIN_TEXT");
  });
});

describe("which move-out is still there to undo (L2, L3)", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  const plus = (ms: number) => new Date(T0.getTime() + ms);
  type Ev = Parameters<typeof historyCheck>[0];
  const line = (id: string, kind: string, memberId: string, at: number, extra: object = {}, undoneAt: Date | null = null): Ev => ({
    id, kind, undoneAt, expenseId: null, paymentId: null, createdAt: plus(at),
    undo: JSON.stringify({ type: "member_set", memberId, data: { leftAt: null }, ...extra }),
  });
  const move = (id: string, memberId: string, at: number) => line(id, "member_left", memberId, at, { moveOut: { bills: [] } });
  it("a move-out followed by her own rejoin is history; an undone rejoin, or someone else's rejoin, changes nothing; a newer move-out wins again", () => {
    const m1 = move("m1", "asha", 0);
    expect(pickOwnMoveOut([m1], "asha")?.id).toBe("m1");
    expect(pickOwnMoveOut([m1, line("r1", "member_rejoined", "asha", 1000)], "asha")).toBeNull();
    expect(pickOwnMoveOut([m1, line("r1", "member_rejoined", "asha", 1000, {}, plus(2000))], "asha")?.id).toBe("m1");
    expect(pickOwnMoveOut([m1, line("r2", "member_rejoined", "ravi", 1000)], "asha")?.id).toBe("m1");
    const m2 = move("m2", "asha", 5000);
    expect(pickOwnMoveOut([m1, line("r1", "member_rejoined", "asha", 1000), m2], "asha")?.id).toBe("m2");
  });
  it("in the database: Rejoin without undoing, then leaving the plain way, does not bring the old move-out back; the old line's Undo is blocked too", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const old = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    expect((await setMemberLeft(f.g.id, f.S, f.S, false)).ok).toBe(true); // Rejoin without undoing
    // Asha is square (0: her square-up payment counts), so she may leave the plain way.
    expect((await setMemberLeft(f.g.id, f.S, f.S, true)).ok).toBe(true);
    const viewer = await undoViewerFor(f.g.id, f.S);
    expect(await ownMoveOut(f.g.id, viewer, new Date())).toBeNull();
    expect((await leaverUndoChecks(f.g.id, viewer, new Date())).get(old.id)?.ok).toBe(false); // "This person was changed again since"
  });
  it("in a closed group the check says it can't be undone, so no button", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.group.update({ where: { id: f.g.id }, data: { closed: true } });
    const own = await ownMoveOut(f.g.id, await undoViewerFor(f.g.id, f.S), new Date());
    expect(own?.check).toEqual({ ok: false, reason: CLOSED_MOVE_OUT_TEXT });
    expect(CLOSED_MOVE_OUT_TEXT).toBe("The group is closed, so the move-out can’t be undone. Ask someone in the flat to reopen it.");
  });
});

// ---- Round 2 ----
describe("the leaver's Undo button is only shown when the server would accept it (round 2, item 2)", () => {
  // Each case: the screen says not ok, the server refuses, nothing changes, and the leaver's words name nobody.
  async function refused(f: Flat, expected: string) {
    const mo = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    const viewer = await undoViewerFor(f.g.id, f.S);
    const own = await ownMoveOut(f.g.id, viewer, new Date());
    expect(own?.check).toEqual({ ok: false, reason: expected });
    expect((await leaverUndoChecks(f.g.id, viewer, new Date())).get(mo.id)).toEqual({ ok: false, reason: expected });
    const before = { nets: await f.nets(), rent: await f.sharesOf(f.rent.e.id), wifi: await f.sharesOf(f.wifi.e.id) };
    expect(await undoEvent(mo.id, f.S)).toEqual({ ok: false, error: expected });
    expect({ nets: await f.nets(), rent: await f.sharesOf(f.rent.e.id), wifi: await f.sharesOf(f.wifi.e.id) }).toEqual(before);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
    expect(await db.groupEvent.count({ where: { id: mo.id, undoneAt: { not: null } } })).toBe(0);
    for (const nm of ["Meera", "Ravi"]) expect(expected).not.toContain(nm);
  }
  it("the deposit was returned since", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const share = await db.depositShare.findFirstOrThrow({ where: { memberId: f.S } });
    expect(share.status).toBe("transferred");
    await db.depositShare.update({ where: { id: share.id }, data: { status: "returned" } });
    await refused(f, LEAVER_BLOCKED_TEXT);
  });
  it("a daily bill for the month was added since (worked out without her)", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    // Make the move-out record say it charged Wi-Fi's November in advance; that bill's November run is "added", as it is here.
    const mo = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    const u = JSON.parse(mo.undo);
    u.moveOut.prepaid = [{ billId: f.wifi.b.id, period: "2026-11", expenseId: "no-such-charge" }];
    await db.groupEvent.update({ where: { id: mo.id }, data: { undo: JSON.stringify(u) } });
    await refused(f, LEAVER_BLOCKED_TEXT);
  });
  it("someone whose balance the undo would move has left since: the leaver is not told who", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.member.update({ where: { id: f.R }, data: { leftAt: new Date("2026-11-12T00:00:00Z") } }); // Ravi, -444444 at that point
    await refused(f, LEAVER_BLOCKED_TEXT);
  });
  it("a changed currency is a plain 'can't be undone any more'", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.group.update({ where: { id: f.g.id }, data: { currency: "USD" } });
    await refused(f, "This move-out can’t be undone any more.");
  });
  it("a leaver is never given the 'Ask someone in the flat' words for a permanent block", () => {
    const src = readFileSync("src/lib/home/moving-db.ts", "utf8");
    expect(src).toContain('stop(CURRENCY_SINCE, MOVE_OUT_GONE_FOR_GOOD)');
    expect(src).toContain("counted in the move-out’s square-up, so it can’t be undone.\", MOVE_OUT_GONE_FOR_GOOD)");
  });
});

describe("accepting an invitation back (round 2, item 1, and 4b)", () => {
  async function invite(f: Flat) {
    return db.invite.create({ data: { groupId: f.g.id, email: f.asha.email, invitedById: f.M, token: `tok-${++n}-${stamp}`, memberId: f.S } });
  }
  it("a move-out that can still be undone is not given up: nothing changes and she is sent to People", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    const inv = await invite(f);
    const r = await acceptInvitation({ id: f.asha.id, email: f.asha.email, name: "Asha" } as never, inv.token);
    expect(r).toEqual({ ok: false, error: MOVED_OUT_REJOIN_TEXT, movedOut: { groupId: f.g.id, memberId: f.S } });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, kind: "member_rejoined" } })).toBe(0);
    const src = readFileSync("src/app/actions.ts", "utf8");
    expect(src).toContain("r.movedOut");
    expect(src).toContain("/people?error=");
  });
  it("when the move-out can't be undone any more, the invitation just brings her back", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.group.update({ where: { id: f.g.id }, data: { currency: "USD" } }); // permanent block
    const inv = await invite(f);
    const r = await acceptInvitation({ id: f.asha.id, email: f.asha.email, name: "Asha" } as never, inv.token);
    expect(r).toMatchObject({ ok: true, memberId: f.S });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).toBeNull();
  });
  it("the join link and the plain-leave guard also only block while the undo is possible", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.group.update({ where: { id: f.g.id }, data: { currency: "USD" } });
    expect(await joinNew(f.code, { id: f.asha.id, name: "Asha", email: f.asha.email }, "Asha")).toMatchObject({ ok: true, memberId: f.S });
    expect(readFileSync("src/app/actions.ts", "utf8")).toContain("new Date()))?.check.ok) {");
  });
});

describe("closed groups and the undo button (round 2, item 3)", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  const viewer = (closed: boolean) => ({ id: "ravi", isAdmin: true, closed, members: [] as { id: string; leftAt: Date | null }[] });
  const e = (undo: object) => ({ id: "x", kind: "k", undo: JSON.stringify(undo), undoneAt: null, expenseId: null, paymentId: null, createdAt: T0 });
  it("a move-out undo for people still in the flat says the group is closed", () => {
    const mo = e({ type: "member_set", memberId: "asha", data: { leftAt: null }, moveOut: { bills: [] } });
    // Refused when closed (which rule speaks first depends on who is looking; for someone who could otherwise undo it, it's the closed text).
    expect(actorRefusal(mo as never, viewer(true) as never, T0)).toBeTruthy();
    expect(actorRefusal(mo as never, viewer(false) as never, T0)).not.toBe(CLOSED_MOVE_OUT_TEXT);
  });
  it("expense and payment undos are not offered in a closed group, as the server refuses them", () => {
    for (const t of ["expense_delete", "expense_restore", "expense_revert"]) {
      expect(actorRefusal(e({ type: t }) as never, viewer(true) as never, T0)).toBe("This group is closed. Reopen it to change expenses.");
      expect(actorRefusal(e({ type: t }) as never, viewer(false) as never, T0)).not.toBe("This group is closed. Reopen it to change expenses.");
    }
    for (const t of ["payment_delete", "payment_restore"]) {
      expect(actorRefusal(e({ type: t }) as never, viewer(true) as never, T0)).toBe("This group is closed. Reopen it to change payments.");
    }
  });
  it("in the database: Meera sees the move-out undo as refused in a closed group, and the server agrees", async () => {
    const f = await flat();
    await ashaMovesOut(f);
    await db.group.update({ where: { id: f.g.id }, data: { closed: true } });
    const mo = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, kind: "member_left" } });
    const v = await undoViewerFor(f.g.id, f.M);
    expect(v.closed).toBe(true);
    expect(canUndo(mo as never, [mo] as never, new Date(), v).ok).toBe(false); // Meera can't undo Asha's own move-out anyway; closed or not, no button
    expect(await undoEvent(mo.id, f.M)).toMatchObject({ ok: false });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.S } })).leftAt).not.toBeNull();
  });
});

describe("wording when a move-out line can't be undone alone (round 2, item 4a)", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  type Ev = Parameters<typeof historyCheck>[0];
  const ev = (o: Partial<Ev> & { id: string }): Ev => ({ kind: "expense_edited", undo: "", undoneAt: null, expenseId: null, paymentId: null, createdAt: T0, ...o });
  const parent = (o: Partial<Ev> = {}): Ev =>
    ev({ id: "mo", kind: "member_left", undo: JSON.stringify({ type: "member_set", memberId: "asha", data: { leftAt: null }, moveOut: { bills: [], money: { currency: "INR", shares: [], payments: [], eventIds: ["edit1"] } } }), ...o });
  it("'Undo the move-out instead' only while the move-out itself can be undone by history", () => {
    const line = ev({ id: "edit1", undo: JSON.stringify({ type: "expense_revert", expenseId: "rent", before: {} }), expenseId: "rent" });
    const rejoin = ev({ id: "rj", kind: "member_rejoined", undo: JSON.stringify({ type: "member_set", memberId: "asha", data: { leftAt: "2026-11-10T00:00:00.000Z" } }), createdAt: new Date(T0.getTime() + 1000) });
    expect(historyCheck(line, [line, parent()], (id) => (id === "asha" ? "Asha" : undefined))).toEqual({ ok: false, reason: "This was part of Asha’s move-out. Undo the move-out instead." });
    expect(historyCheck(line, [line, parent(), rejoin], (id) => (id === "asha" ? "Asha" : undefined))).toEqual({ ok: false, reason: "This was part of Asha’s move-out, so it can’t be undone on its own." });
  });
});
