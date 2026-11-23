import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { billVersion, saveBillFor } from "@/lib/home/bill-setup";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { depositVersion, saveDepositFor } from "@/lib/home/moving-db";

// Re-audit of the outside-review fixes (K round). Throwaway database; paise worked out by hand (₹1 = 100).
// M1: a plain re-save of "Take turns" still adds people who joined since. M2: the money forms redraw when the group's currency changes.
// L1: Activity names only what this save wrote. L2: a cleared usual amount isn't "changed to ₹0".

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let n = 0;
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
});
async function flat(type = "home") {
  const g = await db.group.create({
    data: { name: `K ${++n} ${stamp}`, type, currency: "INR", inviteCode: `k-${n}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
}

describe("M1: re-saving an unchanged Take-turns bill adds a newcomer", () => {
  it("Rent ₹8,000 taking turns Asha, Ravi; Meera joins; Save with nothing changed makes the turns Asha, Ravi, Meera", async () => {
    const f = await flat();
    const input = { template: "rent", name: "Rent", nature: "fixed", amount: "8000", day: "1", payer: "turns", split: "group", ids: [], currency: "INR" };
    const made = await saveBillFor(f.id, f.asha, { ...input, key: `k-m1-${stamp}-abcdefgh` });
    const id = made.ok ? made.id : "";
    expect(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id } })).rotation)).toEqual([f.asha, f.ravi]);
    const meera = (await db.member.create({ data: { groupId: f.id, name: "Meera", createdAt: new Date(2026, 0, 3) } })).id;
    const was = billVersion(await db.bill.findUniqueOrThrow({ where: { id } }));
    expect((await saveBillFor(f.id, f.asha, { ...input, billId: id, was })).ok).toBe(true);
    const after = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(after.rotation)).toEqual([f.asha, f.ravi, meera]);
    expect(after.amount).toBe(800000);
    // A resend of that same save (lost reply) now matches everything stored: quiet success, no second Activity line.
    const lines = await db.groupEvent.count({ where: { groupId: f.id, kind: "bill_changed" } });
    expect((await saveBillFor(f.id, f.asha, { ...input, billId: id, was })).ok).toBe(true);
    expect(await db.groupEvent.count({ where: { groupId: f.id, kind: "bill_changed" } })).toBe(lines);
  });
});

describe("L2: a cleared usual amount", () => {
  it("Electricity usually ₹2,000 is cleared by Ravi; Asha's old page is told it changed, not 'changed to ₹0'", async () => {
    const f = await flat();
    const input = { template: "electricity", name: "Electricity", nature: "varies", amount: "2000", day: "5", payer: f.asha, split: "group", ids: [], currency: "INR" };
    const made = await saveBillFor(f.id, f.asha, { ...input, key: `k-l2-${stamp}-abcdefgh` });
    const id = made.ok ? made.id : "";
    const old = billVersion(await db.bill.findUniqueOrThrow({ where: { id } }));
    expect((await saveBillFor(f.id, f.ravi, { ...input, billId: id, amount: "", was: old })).ok).toBe(true);
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(0);
    const refused = await saveBillFor(f.id, f.asha, { ...input, billId: id, amount: "2500", was: old });
    expect(refused).toEqual({ ok: false, error: "Electricity changed since you opened this page, so nothing was saved. Look again and save once more." });
  });
});

describe("L1: Activity names only the boxes this save wrote", () => {
  it("budgets: Ravi already set Food ₹9,000; Asha's page sets Food ₹9,000 and Bills ₹5,000; her line says only Bills ₹5,000", async () => {
    const f = await flat("couple");
    const shown = { food: "", bills: "" };
    expect((await saveBudgetsFor(f.id, f.ravi, { food: "9000" }, { was: shown })).ok).toBe(true);
    expect((await saveBudgetsFor(f.id, f.asha, { food: "9000", bills: "5000" }, { was: shown })).ok).toBe(true);
    const rows = Object.fromEntries((await db.budget.findMany({ where: { groupId: f.id } })).map((b) => [b.category, b.amount]));
    expect(rows).toEqual({ food: 900000, bills: 500000 });
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.id, actorId: f.asha, text: "updated the monthly budgets" } });
    expect(JSON.parse(line.details)).toEqual(["Bills & Bits: ₹5,000"]);
  });

  it("deposit: Ravi already set Asha's share to ₹36,000; Asha's page sets hers ₹36,000 and Ravi's ₹30,000; her line lists only Ravi's", async () => {
    const f = await flat();
    const shown = { [f.asha]: depositVersion(undefined), [f.ravi]: depositVersion(undefined) };
    expect((await saveDepositFor(f.id, f.ravi, { heldBy: "Landlord", heldByWas: "Landlord", amounts: { [f.asha]: "36000" }, versions: shown })).ok).toBe(true);
    expect((await saveDepositFor(f.id, f.asha, { heldBy: "Landlord", heldByWas: "Landlord", amounts: { [f.asha]: "36000", [f.ravi]: "30000" }, versions: shown })).ok).toBe(true);
    const held = (await db.depositShare.findMany({ where: { deposit: { groupId: f.id }, status: "held" } })).map((s) => s.amount).sort((a, b) => a - b);
    expect(held).toEqual([3000000, 3600000]);
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.id, actorId: f.asha, text: { contains: "updated the deposit" } } });
    expect(JSON.parse(line.details)).toEqual(["Ravi: ₹30,000"]);
  });
});

describe("M2: the money forms redraw when the group's currency changes", () => {
  // A typed amount lives in the browser; the hidden currency is drawn fresh. A key that includes the currency throws the typed
  // amount away when the currency changes, so ₹8,000 typed is never sent as $8,000.
  const src = (p: string) => readFileSync(p, "utf8");
  it("budgets, deposit, bill edit and new bill pages key their form on the group's currency", () => {
    expect(src("src/app/groups/[id]/budgets/page.tsx")).toMatch(/<form key=\{`\$\{group\.currency\}\|\$\{budgetFormKey\(/);
    expect(src("src/app/groups/[id]/deposit/page.tsx")).toMatch(/key=\{`\$\{group\.currency\}\|\$\{depositFormKey\(/);
    expect(src("src/app/groups/[id]/bills/[billId]/page.tsx")).toMatch(/key=\{`\$\{group\.currency\}\|\$\{billVersion\(bill\)\}`\}/);
    expect(src("src/app/groups/[id]/bills/new/page.tsx")).toMatch(/<BillForm\s+key=\{group\.currency\}/);
  });
});
