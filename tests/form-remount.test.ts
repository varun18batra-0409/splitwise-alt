import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// J7: after a "changed since you opened this page" refusal the form is drawn again from what is stored, and carries the matching version,
// so a second tap can never overwrite the newer change. Each form's key changes with its stored values (that is what makes the browser
// throw away what was typed). Throwaway database; paise worked out by hand.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { billVersion, saveBillFor } = await import("@/lib/home/bill-setup");
const { depositFormKey, depositVersion, saveDepositFor } = await import("@/lib/home/moving-db");
const { budgetFormKey } = await import("@/lib/home/budgets");
const { saveBudgetsFor } = await import("@/lib/home/budgets-db");
const { BillForm } = await import("@/components/BillForm");
const { toInputAmount } = await import("@/lib/money");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let n = 0;
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
});
async function flat(type = "home") {
  const g = await db.group.create({
    data: { name: `J7 ${++n} ${stamp}`, type, currency: "INR", inviteCode: `j7-${n}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
}

describe("the bill edit form after a refusal", () => {
  it("Asha's old page (8,000) is refused because Ravi made it 9,000; the form drawn again shows 9,000 and carries the new version", async () => {
    const f = await flat();
    const input = { template: "rent", name: "Rent", nature: "fixed", amount: "8000", day: "1", payer: f.asha, split: "group", ids: [], currency: "INR" };
    const made = await saveBillFor(f.id, f.asha, { ...input, key: `j7-bill-${stamp}-abcdefgh` });
    const id = made.ok ? made.id : "";
    const oldVersion = billVersion(await db.bill.findUniqueOrThrow({ where: { id } }));
    expect((await saveBillFor(f.id, f.ravi, { ...input, billId: id, amount: "9000", was: oldVersion })).ok).toBe(true);
    const refused = await saveBillFor(f.id, f.asha, { ...input, billId: id, amount: "8500", was: oldVersion });
    expect(refused).toEqual({ ok: false, error: "Rent changed to ₹9,000 since you opened this page, so nothing was saved. Look again and save once more." });

    // The page is drawn again from the stored bill.
    const stored = await db.bill.findUniqueOrThrow({ where: { id } });
    const newVersion = billVersion(stored);
    expect(newVersion).not.toBe(oldVersion); // so the page's key (= this) changes and the form is thrown away and drawn again
    const html = renderToStaticMarkup(
      createElement(BillForm, {
        groupId: f.id, members: [{ id: f.asha, name: "Asha" }, { id: f.ravi, name: "Ravi" }], myId: f.asha, splitName: "Home split", splitLabel: "", currency: "INR",
        initial: { billId: id, version: newVersion, template: "rent", name: "Rent", nature: "fixed", amount: toInputAmount(stored.amount, "INR"), day: stored.day, payer: f.asha, split: "group", ids: [] },
      }),
    );
    expect(html).toContain('value="9,000"'); // the stored 900,000 paise, not the 8,500 that was typed
    expect(html).not.toContain("8,500");
    expect(html).toContain(`name="billWas" value="${newVersion}"`);
    // Saving what that form shows works, and writes 9,000 (nothing else is overwritten).
    expect((await saveBillFor(f.id, f.asha, { ...input, billId: id, amount: "9000", was: newVersion })).ok).toBe(true);
    expect((await db.bill.findUniqueOrThrow({ where: { id } })).amount).toBe(900000);
  });
});

describe("the deposit and budget forms' keys change with what is stored", () => {
  it("deposit: Kabir-style change by someone else changes the key, so the form is drawn again with the stored 45,000", async () => {
    const f = await flat();
    await saveDepositFor(f.id, f.asha, { heldBy: "Landlord", amounts: { [f.asha]: "36000" } });
    const keyNow = async () => {
      const rows = await db.depositShare.findMany({ where: { deposit: { groupId: f.id }, status: "held" } });
      const heldBy = (await db.deposit.findUniqueOrThrow({ where: { groupId: f.id } })).heldBy;
      return { key: depositFormKey(heldBy, [f.asha, f.ravi].map((m) => depositVersion(rows.find((r) => r.memberId === m)))), rows };
    };
    const before = await keyNow();
    expect(before.key).toBe(await keyNow().then((x) => x.key)); // the same stored values give the same key (no needless redraw)
    await saveDepositFor(f.id, f.ravi, { heldBy: "Landlord", amounts: { [f.asha]: "45000" } });
    const after = await keyNow();
    expect(after.key).not.toBe(before.key);
    expect(after.rows.map((r) => r.amount)).toEqual([4500000]);
    // The holder changing changes it too.
    await saveDepositFor(f.id, f.ravi, { heldBy: "Mr Rao", amounts: {} });
    expect((await keyNow()).key).not.toBe(after.key);
  });

  it("budgets: another person's change to Food (800,000 to 850,000) changes the key; an unchanged form keeps it", async () => {
    const f = await flat("couple");
    await saveBudgetsFor(f.id, f.asha, { food: "8000" });
    const was = async () => Object.fromEntries((await db.budget.findMany({ where: { groupId: f.id } })).map((b) => [b.category, String(b.amount)]));
    const k1 = budgetFormKey(await was());
    expect(budgetFormKey(await was())).toBe(k1);
    await saveBudgetsFor(f.id, f.ravi, { food: "8500" });
    expect(budgetFormKey(await was())).not.toBe(k1);
    expect((await db.budget.findFirstOrThrow({ where: { groupId: f.id } })).amount).toBe(850000);
  });
});
