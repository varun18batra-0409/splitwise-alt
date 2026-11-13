import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { loadGroup } from "@/lib/group-data";
import { createPayment } from "@/lib/payments";
import { confirmClaim, declineClaim, makeClaim, withdrawClaim, claimsWaitingFor } from "@/lib/payment-claims";
import { confirmPayment, rejectPayment } from "@/lib/payment-ok";
import { payLinkFor, readPayLink } from "@/lib/pay-link";
import { markAllPaid, planKey, settleAllAndClose } from "@/lib/settle-all";
import { undoEvent } from "@/lib/undo";
import { overpayLine } from "@/lib/money";
import { spentAmount } from "@/lib/payers";
import { isMemberUsed } from "@/lib/people";

// "I've paid" claims against a real (throwaway) database. A claim is NOT a payment: it never moves a
// balance. Only "Confirm received" records the real payment, once. Amounts are paise.
//
// The cast, in this order: Asha, Ravi, Meera (all have joined, so each can tap Confirm received).
// The base case (worked out by hand): Dinner ₹900 = 90000, Asha paid, split 3 ways = 30000 each.
//   Asha: paid 90000, share 30000 → +60000.   Ravi: −30000.   Meera: −30000.   (sum 0)
// Smart Settle: Ravi → Asha 30000 and Meera → Asha 30000.

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

async function world(opts: { dinner?: number; shares?: [number, number, number] } = {}) {
  const total = opts.dinner ?? 90000;
  const [sa, sr, sm] = opts.shares ?? [30000, 30000, 30000];
  const g = await db.group.create({
    data: {
      name: "Claims",
      currency: "INR",
      inviteCode: `claims-${Date.now()}-${Math.random()}`,
      members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const [a, r, m] = [id("Asha"), id("Ravi"), id("Meera")];
  const dinner = await db.expense.create({
    data: {
      groupId: g.id, description: "Dinner", amount: total, splitType: "equal", paidById: a, createdById: a, originalAmount: total, convertedAmount: total,
      shares: { create: [{ memberId: a, amount: sa }, { memberId: r, amount: sr }, { memberId: m, amount: sm }] },
    },
  });
  return { gid: g.id, a, r, m, dinner: dinner.id };
}

async function net(gid: string) {
  const members = await db.member.findMany({ where: { groupId: gid }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId: gid, deletedAt: null } }),
  ]);
  return netBalances(members.map((x) => x.id), expenses, payments);
}
const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);
const payments = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });
const claim = async (w: Awaited<ReturnType<typeof world>>, from = w.r, to = w.a) => {
  const c = await makeClaim({ groupId: w.gid, fromId: from, toId: to, actorId: from, source: "link" });
  if (!c.ok) throw new Error(c.error);
  return c;
};

describe("T1: a claim never changes a balance", () => {
  it("Ravi claims ₹300: balances stay A +60000, R −30000, M −30000 and Settle still shows both payments", async () => {
    const w = await world();
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
    const c = await claim(w);
    expect(c.amount).toBe(30000);
    const n = await net(w.gid);
    expect(n).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
    expect(sum(n)).toBe(0);
    expect(await payments(w.gid)).toBe(0);
    const data = (await loadGroup(w.gid, { events: false }))!;
    expect(data.transfers.map((t) => [t.from, t.to, t.amount]).sort()).toEqual([[w.m, w.a, 30000], [w.r, w.a, 30000]].sort());
    // The history says so, and no balance is marked as moved.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, kind: "payment_claimed" } });
    expect(ev.text).toBe("says they paid Asha ₹300 (waiting for Asha to confirm)");
    expect(ev.touches).toBe("");
    // Asha sees it waiting for her.
    expect((await claimsWaitingFor(w.gid, w.a)).map((x) => [x.fromName, x.amount])).toEqual([["Ravi", 30000]]);
  });
});

describe("T2: Confirm received records the payment, once", () => {
  it("A +30000, R 0, M −30000; confirming twice (even at once) leaves exactly 1 payment; Undo takes it back", async () => {
    const w = await world();
    const c = await claim(w);
    const done = await confirmClaim(c.claimId, w.a);
    expect(done.ok).toBe(true);
    const n = await net(w.gid);
    expect(n).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    expect(sum(n)).toBe(0);
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect([p.fromId, p.toId, p.amount, p.needsOk, p.okAt !== null]).toEqual([w.r, w.a, 30000, true, true]);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).paymentId).toBe(p.id);

    // Again, and twice at the same moment: still one.
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(true);
    await Promise.all([confirmClaim(c.claimId, w.a), confirmClaim(c.claimId, w.a)]);
    expect(await payments(w.gid)).toBe(1);

    // The change in the history has an Undo (payment_delete), which puts Ravi back to −30000.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, paymentId: p.id } });
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_delete", paymentId: p.id });
    expect((await undoEvent(ev.id, w.a)).ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
  });

  it("two people confirming at the same moment record one payment", async () => {
    const w = await world();
    const c = await claim(w);
    const [x, y] = await Promise.all([confirmClaim(c.claimId, w.a), confirmClaim(c.claimId, w.a)]);
    expect(x.ok && y.ok).toBe(true);
    expect(await payments(w.gid)).toBe(1);
  });
});

describe("T3: Not received", () => {
  it("balances stay as they were, the link says 'hasn't received it yet', and Ravi can tap again", async () => {
    const w = await world();
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    const c = await claim(w);
    const waiting = await readPayLink(token);
    expect(waiting.kind).toBe("said");
    expect(waiting.kind === "said" && waiting.claimId).toBe(c.claimId);

    expect((await declineClaim(c.claimId, w.a)).ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
    const after = await readPayLink(token);
    expect(after.kind).toBe("owes");
    expect(after.kind === "owes" && [after.amount, after.declined]).toEqual([30000, true]); // "owes ₹300" again, with the note
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(false); // a declined claim can't be confirmed

    // Tap again: a new claim, which can be confirmed.
    const again = await claim(w);
    expect(again.claimId).not.toBe(c.claimId);
    expect((await confirmClaim(again.claimId, w.a)).ok).toBe(true);
    const square = await readPayLink(token);
    expect(square.kind === "owes").toBe(false); // R owes nothing now: "square, confirmed"
    expect(square.kind === "square" && square.confirmed).toBe(true);
  });
});

describe("T4: taking it back", () => {
  it("allowed while waiting; refused after a confirm", async () => {
    const w = await world();
    const c1 = await claim(w);
    expect((await withdrawClaim(c1.claimId, w.r)).ok).toBe(true);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c1.claimId } })).status).toBe("withdrawn");
    expect((await confirmClaim(c1.claimId, w.a)).ok).toBe(false); // nothing to confirm
    expect(await payments(w.gid)).toBe(0);

    const c2 = await claim(w);
    expect((await confirmClaim(c2.claimId, w.a)).ok).toBe(true);
    const late = await withdrawClaim(c2.claimId, w.r);
    expect(late.ok).toBe(false);
    expect(!late.ok && late.error).toMatch(/already confirmed/);
    expect(await payments(w.gid)).toBe(1);
  });
});

describe("T5: two taps at once", () => {
  it("make exactly one claim and one history line", async () => {
    const w = await world();
    const [x, y] = await Promise.all([
      makeClaim({ groupId: w.gid, fromId: w.r, toId: w.a, actorId: w.r, source: "link" }),
      makeClaim({ groupId: w.gid, fromId: w.r, toId: w.a, actorId: w.r, source: "app" }),
    ]);
    expect(x.ok && y.ok).toBe(true);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid, status: "waiting" } })).toBe(1);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(1);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "payment_claimed" } })).toBe(1);
  });
});

describe("T6: the same money recorded another way covers the claim", () => {
  it("claim waiting, then Mark all paid: 2 payments, claim covered, everyone 0, confirming the old claim records nothing", async () => {
    const w = await world();
    const c = await claim(w);
    const data = (await loadGroup(w.gid, { events: false }))!;
    const r = await markAllPaid(w.gid, w.a, data.transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount })), "", true);
    expect(r.ok).toBe(true);
    expect(await payments(w.gid)).toBe(2);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("covered");
    const n = await net(w.gid);
    expect(n).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });

    const old = await confirmClaim(c.claimId, w.a);
    expect(old.ok).toBe(false);
    expect(await payments(w.gid)).toBe(2);
    expect(await net(w.gid)).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });

  it("Settle everything & close, a part payment and a plain createPayment all cover a waiting claim too", async () => {
    const closed = await world();
    const c1 = await claim(closed);
    const plan = planKey((await loadGroup(closed.gid, { events: false }))!.transfers);
    expect((await settleAllAndClose(closed.gid, closed.a, plan)).ok).toBe(true);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c1.claimId } })).status).toBe("covered");

    // A part payment of ₹100 (10000) from Ravi to Asha covers it as well; a payment the other way does not.
    const w = await world();
    const c2 = await claim(w);
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.a, toId: w.r, amount: 100, createdById: w.a }));
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c2.claimId } })).status).toBe("waiting");
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 10000, createdById: w.a }));
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c2.claimId } })).status).toBe("covered");
    expect((await confirmClaim(c2.claimId, w.a)).ok).toBe(false);
    expect(await payments(w.gid)).toBe(2); // the two direct ones only
  });
});

describe("T7: the expense was edited after the claim", () => {
  it("Dinner now ₹600 (Ravi owes 20000): asked once ('₹100 more'), and if confirmed A +10000, R +10000, M −20000", async () => {
    const w = await world();
    const c = await claim(w); // claims 30000
    await db.expense.update({ where: { id: w.dinner }, data: { amount: 60000, originalAmount: 60000, convertedAmount: 60000 } });
    await db.expenseShare.updateMany({ where: { expenseId: w.dinner }, data: { amount: 20000 } });
    expect(await net(w.gid)).toEqual({ [w.a]: 40000, [w.r]: -20000, [w.m]: -20000 });

    const ask = await confirmClaim(c.claimId, w.a);
    expect(ask.ok).toBe(false);
    expect(!ask.ok && ask.over).toBe(10000);
    expect(overpayLine(30000, 20000, "INR", "Confirm anyway?")).toBe("This is ₹100 more than what's owed. Confirm anyway?");
    expect(await payments(w.gid)).toBe(0); // Cancel is the default: nothing saved

    expect((await confirmClaim(c.claimId, w.a, { over: true })).ok).toBe(true);
    const n = await net(w.gid);
    expect(n).toEqual({ [w.a]: 10000, [w.r]: 10000, [w.m]: -20000 });
    expect(sum(n)).toBe(0);
  });
});

describe("T8: ₹100 split 3 ways (3334 / 3333 / 3333)", () => {
  it("the link offers 3333; after confirm R 0, A +3333, M −3333", async () => {
    const w = await world({ dinner: 10000, shares: [3334, 3333, 3333] });
    expect(await net(w.gid)).toEqual({ [w.a]: 6666, [w.r]: -3333, [w.m]: -3333 });
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    const s = await readPayLink(token);
    expect(s.kind === "owes" && s.amount).toBe(3333);
    const c = await claim(w);
    expect(c.amount).toBe(3333);
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(true);
    const n = await net(w.gid);
    expect(n).toEqual({ [w.a]: 3333, [w.r]: 0, [w.m]: -3333 });
    expect(sum(n)).toBe(0);
  });
});

describe("T9: payments made through the link before claims existed", () => {
  it("still count before and after; Confirm keeps the balances; Not received makes R −30000; Undo brings back R 0", async () => {
    const w = await world();
    const old = await db.payment.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.r, needsOk: true } });
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await db.payLink.update({ where: { token }, data: { paymentId: old.id } });
    const base = { [w.a]: 30000, [w.r]: 0, [w.m]: -30000 };
    expect(await net(w.gid)).toEqual(base); // counts already

    // The link page still treats it as "said", with no claim behind it.
    const s = await readPayLink(token);
    expect(s.kind).toBe("said");
    expect(s.kind === "said" && s.claimId).toBeUndefined();

    expect((await confirmPayment(old.id, w.a)).ok).toBe(true);
    expect(await net(w.gid)).toEqual(base); // no balance change on confirm

    const w2 = await world();
    const old2 = await db.payment.create({ data: { groupId: w2.gid, fromId: w2.r, toId: w2.a, amount: 30000, createdById: w2.r, needsOk: true } });
    const rej = await rejectPayment(old2.id, w2.a);
    expect(rej.ok).toBe(true);
    expect(await net(w2.gid)).toEqual({ [w2.a]: 60000, [w2.r]: -30000, [w2.m]: -30000 });
    expect((await undoEvent(rej.ok ? rej.eventId! : "", w2.a)).ok).toBe(true);
    expect(await net(w2.gid)).toEqual({ [w2.a]: 30000, [w2.r]: 0, [w2.m]: -30000 });
  });
});

describe("T10: the group currency changed while a claim waited", () => {
  it("Confirm is refused, the claim is out of date, and no payment is recorded", async () => {
    const w = await world();
    const c = await claim(w);
    await db.group.update({ where: { id: w.gid }, data: { currency: "USD" } });
    const r = await confirmClaim(c.claimId, w.a);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/currency changed/);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("expired");
    expect(await payments(w.gid)).toBe(0);
  });

  it("a closed group can't confirm either", async () => {
    const w = await world();
    const c = await claim(w);
    await db.group.update({ where: { id: w.gid }, data: { closed: true } });
    const r = await confirmClaim(c.claimId, w.a);
    expect(r.ok).toBe(false);
    expect(await payments(w.gid)).toBe(0);
    expect((await makeClaim({ groupId: w.gid, fromId: w.m, toId: w.a, actorId: w.m, source: "app" })).ok).toBe(false);
  });
});

describe("T11: who can act", () => {
  it("only the person paid confirms or declines; only the payer takes it back; strangers and other pairs can do nothing", async () => {
    const w = await world();
    const c = await claim(w); // Ravi → Asha
    const other = await claim(w, w.m, w.a); // Meera → Asha

    for (const who of [w.m, w.r, "a-stranger", undefined]) {
      expect((await confirmClaim(c.claimId, who)).ok, `confirm by ${who}`).toBe(false);
      expect((await declineClaim(c.claimId, who)).ok, `decline by ${who}`).toBe(false);
    }
    // Withdrawing: not Meera (another pair), not Asha (the one paid), not a stranger.
    for (const who of [w.m, w.a, "a-stranger", undefined]) expect((await withdrawClaim(c.claimId, who)).ok, `withdraw by ${who}`).toBe(false);
    // Ravi's link can't touch Meera's claim.
    expect((await withdrawClaim(other.claimId, w.r)).ok).toBe(false);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid, status: "waiting" } })).toBe(2);
    expect(await payments(w.gid)).toBe(0);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
  });

  it("someone who left can still answer for money paid TO them, but can't claim a payment of their own", async () => {
    const w = await world();
    const c = await claim(w);
    await db.member.update({ where: { id: w.a }, data: { leftAt: new Date() } });
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(true);
    expect(await payments(w.gid)).toBe(1);

    const w2 = await world();
    await db.member.update({ where: { id: w2.r }, data: { leftAt: new Date() } });
    expect((await makeClaim({ groupId: w2.gid, fromId: w2.r, toId: w2.a, actorId: w2.r, source: "app" })).ok).toBe(false);
  });

  it("someone who left can't take back a claim (it stays waiting); a current member's take-back works", async () => {
    const w = await world();
    const c = await claim(w); // Ravi → Asha
    await db.member.update({ where: { id: w.r }, data: { leftAt: new Date() } });
    const refused = await withdrawClaim(c.claimId, w.r);
    expect(refused.ok).toBe(false);
    expect((await db.paymentClaim.findUnique({ where: { id: c.claimId } }))?.status).toBe("waiting");

    const w2 = await world();
    const c2 = await claim(w2);
    expect((await withdrawClaim(c2.claimId, w2.r)).ok).toBe(true);
    expect((await db.paymentClaim.findUnique({ where: { id: c2.claimId } }))?.status).toBe("withdrawn");
  });

  it("a name-only person can't confirm, so no claim is made to them (the caller records a payment instead)", async () => {
    const w = await world();
    const g = await db.member.create({ data: { groupId: w.gid, name: "Dev" } });
    const r = await makeClaim({ groupId: w.gid, fromId: w.r, toId: g.id, actorId: w.r, source: "app" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.direct).toBe(true);
  });
});

describe("other rules", () => {
  it("only what is owed right now can be claimed, and a stale amount is refused", async () => {
    const w = await world();
    const nothing = await makeClaim({ groupId: w.gid, fromId: w.a, toId: w.r, actorId: w.a, source: "app" }); // Asha owes nobody
    expect(nothing.ok).toBe(false);
    const stale = await makeClaim({ groupId: w.gid, fromId: w.r, toId: w.a, actorId: w.r, source: "app", expectAmount: 99900 });
    expect(stale.ok).toBe(false);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
  });

  it("a person with a claim counts as 'used', so they can't be deleted from the group", async () => {
    const w = await world();
    const extra = await db.member.create({ data: { groupId: w.gid, name: "Zed", claimedAt: new Date() } });
    expect(await isMemberUsed(extra.id)).toBe(false);
    await db.paymentClaim.create({ data: { groupId: w.gid, fromId: extra.id, toId: w.a, amount: 100, currency: "INR" } });
    expect(await isMemberUsed(extra.id)).toBe(true);
  });

  it("claims stay out of every total: no payment row, and spending is unchanged", async () => {
    const w = await world();
    await claim(w);
    const exps = await db.expense.findMany({ where: { groupId: w.gid } });
    expect(exps.reduce((s, e) => s + spentAmount(e), 0)).toBe(90000);
    expect(await payments(w.gid)).toBe(0);
  });
});

describe("the claim's history line names its claim", () => {
  it("makeClaim writes one 'says they paid' line whose payment reference is claim:<id> (a reference no payment has), so Alerts can match it exactly", async () => {
    const w = await world();
    const c = await claim(w);
    const lines = await db.groupEvent.findMany({ where: { groupId: w.gid, kind: "payment_claimed" } });
    expect(lines).toHaveLength(1);
    expect(lines[0].paymentId).toBe(`claim:${c.claimId}`);
    expect(await db.payment.count({ where: { id: lines[0].paymentId! } })).toBe(0);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 }); // still no balance change
  });
});
