import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { expensePairs } from "@/lib/payers";
import { createGroupFor, updateSharing } from "@/lib/group-setup";
import { sharingInputs } from "@/lib/group-types";
import { groupCsv } from "@/lib/csv";
import { spentByCurrency } from "@/lib/secondary";

// Fixes from the Phase 3 review.

describe("who owes whom for one expense (the Add screen's preview)", () => {
  const shares = [{ memberId: "you", amount: 112500 }, { memberId: "asha", amount: 93750 }, { memberId: "rohan", amount: 93750 }];
  it("two payers: everyone owes the payers in proportion, netted per pair", () => {
    const pairs = expensePairs({ paidById: "you", amount: 300000, payers: JSON.stringify([{ m: "you", a: 200000 }, { m: "asha", a: 100000 }]), shares });
    expect(pairs).toEqual([
      { from: "asha", to: "you", amount: 25000 },
      { from: "rohan", to: "you", amount: 62500 },
      { from: "rohan", to: "asha", amount: 31250 },
    ]);
  });
  it("money back: whoever got it owes the others", () => {
    const pairs = expensePairs({
      paidById: "asha", amount: 150000, kind: "refund",
      shares: [{ memberId: "you", amount: 50000 }, { memberId: "asha", amount: 50000 }, { memberId: "rohan", amount: 50000 }],
    });
    expect(pairs).toEqual([
      { from: "asha", to: "you", amount: 50000 },
      { from: "asha", to: "rohan", amount: 50000 },
    ]);
  });
});

describe("How you share costs (settings)", () => {
  const stamp = Date.now();
  const made: string[] = [];
  afterAll(async () => {
    for (const id of made) await db.group.delete({ where: { id } }).catch(() => {});
    await db.account.deleteMany({ where: { email: { contains: `rv3-${stamp}` } } });
  });
  it("shows a couple's split as percents: 100 / 100 is 50 / 50", () => {
    expect(sharingInputs("couple", [100, 100])).toEqual(["50", "50"]);
    expect(sharingInputs("couple", [55, 45])).toEqual(["55", "45"]);
    expect(sharingInputs("home", [120, 100])).toEqual(["1.2", "1"]);
  });
  it("a default 50 / 50 couple can be saved, and percents must add up to 100", async () => {
    const me = await db.account.create({ data: { email: `me-rv3-${stamp}@example.com`, name: "V" } });
    const g = await createGroupFor(me, { type: "couple", name: "Us", yourName: "V", currency: "INR" });
    made.push(g.id);
    const p = await db.member.create({ data: { name: "R", groupId: g.id } });
    const ok = await updateSharing(g.id, g.members[0].id, { type: "couple", weights: { [g.members[0].id]: "50", [p.id]: "50" } });
    expect(ok.ok).toBe(true);
    const bad = await updateSharing(g.id, g.members[0].id, { type: "couple", weights: { [g.members[0].id]: "60", [p.id]: "30" } });
    expect(bad).toEqual({ ok: false, error: "The two parts need to add up to 100%." });
  });
  it("switching a 55 / 45 couple to Home keeps the same split", async () => {
    const me = await db.account.findFirstOrThrow({ where: { email: `me-rv3-${stamp}@example.com` } });
    const g = await createGroupFor(me, { type: "couple", name: "Us 2", yourName: "V", currency: "INR", ratio: 55 });
    made.push(g.id);
    const p = await db.member.create({ data: { name: "R", groupId: g.id, splitWeight: 45 } });
    // The form still shows the couple's percents when the type is switched.
    const r = await updateSharing(g.id, g.members[0].id, { type: "home", weights: { [g.members[0].id]: "55", [p.id]: "45" } });
    expect(r.ok).toBe(true);
    const after = await db.member.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } });
    expect(after.map((m) => m.splitWeight)).toEqual([55, 45]);
  });
});

describe("spreadsheet export", () => {
  it("shows each payer's part, and money back as negative amounts", () => {
    const members = [{ id: "you", name: "You" }, { id: "asha", name: "Asha" }];
    const base = { notes: "", category: "food", originalCurrency: "INR", originalAmount: 0, exchangeRate: "1", markupAmount: 0, paymentMethod: "", createdAt: new Date("2026-10-14T10:00:00Z"), deletedAt: null };
    const csv = groupCsv(
      { name: "G", currency: "INR" },
      members,
      [
        { ...base, description: "Dinner", amount: 300000, originalAmount: 300000, paidById: "you", payers: JSON.stringify([{ m: "you", a: 200000 }, { m: "asha", a: 100000 }]), shares: [{ memberId: "you", amount: 150000 }, { memberId: "asha", amount: 150000 }] },
        { ...base, description: "Refund", amount: 150000, originalAmount: 150000, paidById: "asha", kind: "refund", shares: [{ memberId: "you", amount: 75000 }, { memberId: "asha", amount: 75000 }] },
      ],
      [],
    );
    expect(csv).toContain("You 2000.00 + Asha 1000.00");
    expect(csv).toMatch(/Money back,Refund,,Food,Asha,-1500\.00/);
    expect(csv).toContain("-750.00");
  });
});

describe("spent by currency", () => {
  it("money back reduces what was spent", () => {
    const r = spentByCurrency([
      { originalCurrency: "THB", originalAmount: 100000, amount: 257500 },
      { originalCurrency: "THB", originalAmount: 20000, amount: 51500, kind: "refund" },
    ]);
    expect(r).toEqual([{ currency: "THB", original: 80000, group: 206000, count: 2 }]);
  });
});
