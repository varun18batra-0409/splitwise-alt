import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { STALE_KEY_ERROR } from "@/lib/once";
import { billVersion, saveBillFor, type BillInput } from "@/lib/home/bill-setup";
import { runBillsForGroup } from "@/lib/home/bills-db";
import { checkBooks } from "./helpers/money-invariants";

// Batch 4 of the outside-review fixes (G41): setting up a bill twice (a double tap, or a retry after a lost reply) makes one bill.
// Throwaway database. Money is in paise; worked out by hand.
//
// Rent ₹8,000 = 800,000 paise, paid by Asha, split equally between Asha and Ravi: 400,000 + 400,000 = 800,000.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let counter = 0;
const newKey = () => `rent-${stamp}-${++counter}-abcdefgh`;
const setupDay = new Date("2026-11-02T06:00:00Z");

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
});

async function flat() {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `G41 ${n} ${stamp}`, type: "home", currency: "INR", inviteCode: `g41-${n}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
}
const rent = (f: { asha: string }, over: Partial<BillInput> = {}): BillInput => ({
  template: "rent", name: "Rent", nature: "fixed", amount: "8000", day: "1", payer: f.asha, split: "group", ids: [], currency: "INR", ...over,
});
const billCount = (gid: string) => db.bill.count({ where: { groupId: gid, deletedAt: null } });
const addedEvents = (gid: string) => db.groupEvent.count({ where: { groupId: gid, kind: "bill_added" } });

describe("G41: a retry can't create a second bill", () => {
  it("the same form with the same key submitted twice: 1 bill, 1 bill_added line, and one month's run makes one expense of 800,000", async () => {
    const f = await flat();
    const k = newKey();
    const first = await saveBillFor(f.id, f.asha, rent(f, { key: k }), setupDay);
    const second = await saveBillFor(f.id, f.asha, rent(f, { key: k }), setupDay);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && first.ok && second.id).toBe(first.ok ? first.id : "");
    expect(await billCount(f.id)).toBe(1);
    expect(await addedEvents(f.id)).toBe(1);

    // The run for the bill's first month: one expense, 400,000 + 400,000 = 800,000, paid by Asha.
    const bill = await db.bill.findFirstOrThrow({ where: { groupId: f.id } });
    await runBillsForGroup(f.id, new Date(`${bill.startMonth}-05T06:00:00Z`));
    const expenses = await db.expense.findMany({ where: { groupId: f.id, description: "Rent" }, include: { shares: true } });
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(800000);
    expect(expenses[0].shares.map((s) => s.amount).sort()).toEqual([400000, 400000]);
    // Asha paid 800,000 and owes 400,000: +400,000. Ravi owes 400,000: -400,000. The books add up to 0.
    expect(await checkBooks(f.id)).toEqual({ [f.asha]: 400000, [f.ravi]: -400000 });
  });

  it("the same key with a different amount within 2 minutes is refused, and there is still 1 bill", async () => {
    const f = await flat();
    const k = newKey();
    expect((await saveBillFor(f.id, f.asha, rent(f, { key: k }), setupDay)).ok).toBe(true);
    const r = await saveBillFor(f.id, f.asha, rent(f, { key: k, amount: "9000" }), setupDay);
    expect(r).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await billCount(f.id)).toBe(1);
    expect((await db.bill.findFirstOrThrow({ where: { groupId: f.id } })).amount).toBe(800000);
  });

  it("a new key makes a second bill (an intentional duplicate still works)", async () => {
    const f = await flat();
    expect((await saveBillFor(f.id, f.asha, rent(f, { key: newKey() }), setupDay)).ok).toBe(true);
    expect((await saveBillFor(f.id, f.asha, rent(f, { key: newKey() }), setupDay)).ok).toBe(true);
    expect(await billCount(f.id)).toBe(2);
    expect(await addedEvents(f.id)).toBe(2);
  });

  it("two requests with the same key at the same moment make one bill", async () => {
    const f = await flat();
    const k = newKey();
    const [a, b] = await Promise.all([saveBillFor(f.id, f.asha, rent(f, { key: k }), setupDay), saveBillFor(f.id, f.asha, rent(f, { key: k }), setupDay)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    expect(await billCount(f.id)).toBe(1);
    expect(await addedEvents(f.id)).toBe(1);
  });

  it("the group's currency changed since the page was drawn: refused, 0 bills", async () => {
    const f = await flat();
    await db.group.update({ where: { id: f.id }, data: { currency: "USD" } });
    const r = await saveBillFor(f.id, f.asha, rent(f, { key: newKey(), currency: "INR" }), setupDay);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("currency changed to USD");
    expect(await billCount(f.id)).toBe(0);
    expect(await addedEvents(f.id)).toBe(0);
  });

  it("editing a bill after the currency changed is refused too", async () => {
    const f = await flat();
    const made = await saveBillFor(f.id, f.asha, rent(f, { key: newKey() }), setupDay);
    expect(made.ok).toBe(true);
    await db.group.update({ where: { id: f.id }, data: { currency: "USD" } });
    const r = await saveBillFor(f.id, f.asha, rent(f, { billId: made.ok ? made.id : "", amount: "9000", currency: "INR" }), setupDay);
    expect(r.ok).toBe(false);
    expect((await db.bill.findFirstOrThrow({ where: { groupId: f.id } })).amount).toBe(800000);
  });
});

describe("J5: an old bill edit page never overwrites a newer change", () => {
  it("Asha's page showed 8,000; Ravi changed it to 9,000; Asha saves 8,500 from the old page: refused, the bill stays 9,000 and the month adds 900,000 = 450,000 + 450,000", async () => {
    const f = await flat();
    const made = await saveBillFor(f.id, f.asha, rent(f, { key: newKey() }), setupDay);
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : "";
    const shown = billVersion(await db.bill.findUniqueOrThrow({ where: { id } })); // what Asha's page carried
    // Ravi, from a current page, changes the amount to 9,000.
    const ravisPage = shown;
    expect((await saveBillFor(f.id, f.ravi, rent(f, { billId: id, amount: "9000", was: ravisPage }), setupDay)).ok).toBe(true);
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(900000);
    const r = await saveBillFor(f.id, f.asha, rent(f, { billId: id, amount: "8500", was: shown }), setupDay);
    expect(r).toEqual({ ok: false, error: "Rent changed since you opened this page, so nothing was saved. Look again and save once more." });
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(900000);
    // The month's run uses 9,000: 900,000 split 450,000 + 450,000, Asha (payer) +450,000 and Ravi -450,000.
    const bill = await db.bill.findUniqueOrThrow({ where: { id } });
    await runBillsForGroup(f.id, new Date(`${bill.startMonth}-05T06:00:00Z`));
    const e = await db.expense.findFirstOrThrow({ where: { groupId: f.id, description: "Rent" }, include: { shares: true } });
    expect(e.amount).toBe(900000);
    expect(e.shares.map((x) => x.amount).sort()).toEqual([450000, 450000]);
    expect(await checkBooks(f.id)).toEqual({ [f.asha]: 450000, [f.ravi]: -450000 });
  });

  it("a current page saves; a page that is current but whose version is garbled is refused", async () => {
    const f = await flat();
    const made = await saveBillFor(f.id, f.asha, rent(f, { key: newKey() }), setupDay);
    const id = made.ok ? made.id : "";
    const now = billVersion(await db.bill.findUniqueOrThrow({ where: { id } }));
    expect((await saveBillFor(f.id, f.asha, rent(f, { billId: id, amount: "8500", was: now }), setupDay)).ok).toBe(true);
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(850000);
    const bad = await saveBillFor(f.id, f.asha, rent(f, { billId: id, amount: "7000", was: "nonsense" }), setupDay);
    expect(bad.ok).toBe(false);
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(850000);
  });
});
