import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { loadGroup } from "@/lib/group-data";
import { createPayment } from "@/lib/payments";
import { planSettleRow, settleRowFacts } from "@/lib/settle-row";

// The Settle up page, wired to the real data (the page itself needs a browser; these are the same calls it makes):
// the payer's row offers "I've paid" and records the payment: it counts straight away, whether the person paid has joined or not.
//
// Cast: Asha (the viewer, a payer), Meera (joined), Kabir (a name only, never joined).
//   Meera paid ₹600 for Asha and herself: 30000 each.   Kabir paid ₹600 for Asha and himself: 30000 each.
//   Asha owes Meera 30000 and Kabir 30000 (paise); Meera +30000, Kabir +30000, Asha -60000 (sum 0).

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

async function world() {
  const g = await db.group.create({
    data: {
      name: "Wiring",
      currency: "INR",
      inviteCode: `wire-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }, { name: "Kabir", addedBy: "x" }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const [asha, meera, kabir] = [id("Asha"), id("Meera"), id("Kabir")];
  for (const payer of [meera, kabir]) {
    await db.expense.create({
      data: { groupId: g.id, description: "Dinner", amount: 60000, splitType: "equal", paidById: payer, createdById: payer, originalAmount: 60000, convertedAmount: 60000, shares: { create: [{ memberId: asha, amount: 30000 }, { memberId: payer, amount: 30000 }] } },
    });
  }
  return { gid: g.id, asha, meera, kabir };
}

async function rowFor(gid: string, asha: string, to: string) {
  const data = await loadGroup(gid, { events: false });
  const t = data!.transfers.find((x) => x.from === asha && x.to === to)!;
  // The same helper the Settle up page calls, fed from the real group the way the page feeds it.
  const plan = planSettleRow(settleRowFacts({ transfer: t, myId: asha, closed: data!.group.closed, iLeft: Boolean(data!.group.members.find((m) => m.id === asha)?.leftAt), payApps: 0 }));
  return { t, plan };
}

describe("Settle up: the payer's row", () => {
  it("to someone who has joined it records the payment: it counts at once and the balance moves", async () => {
    const w = await world();
    const { t, plan } = await rowFor(w.gid, w.asha, w.meera);
    expect(t.amount).toBe(30000);
    expect(plan).toMatchObject({ action: "record", actionLabel: "I’ve paid" });
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.asha, toId: w.meera, amount: t.amount, createdById: w.asha }));
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid, toId: w.meera } });
    expect(p).toMatchObject({ amount: 30000, needsOk: false });
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    const after = await loadGroup(w.gid, { events: false });
    expect(after!.transfers.some((x) => x.from === w.asha && x.to === w.meera)).toBe(false); // square with Meera
    expect(after!.transfers.find((x) => x.from === w.asha && x.to === w.kabir)?.amount).toBe(30000); // Kabir's still owed
  });

  it("to a name-only person it says the same words and records the payment straight away", async () => {
    const w = await world();
    const { t, plan } = await rowFor(w.gid, w.asha, w.kabir);
    expect(plan).toMatchObject({ action: "record", actionLabel: "I’ve paid" });
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.asha, toId: w.kabir, amount: t.amount, createdById: w.asha }));
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect(p).toMatchObject({ amount: 30000, needsOk: false });
    const after = await loadGroup(w.gid, { events: false });
    expect(after!.transfers.some((x) => x.from === w.asha && x.to === w.kabir)).toBe(false); // square with Kabir
    expect(after!.transfers.find((x) => x.from === w.asha && x.to === w.meera)?.amount).toBe(30000); // Meera's still owed
  });
});
