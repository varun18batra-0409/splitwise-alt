import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { FORM_OUT_OF_DATE } from "@/lib/form-currency";
import { depositVersion, moveOut, returnDepositFor, saveDepositFor } from "@/lib/home/moving-db";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { checkBooks } from "./helpers/money-invariants";

// Batch 3 of the outside-review fixes: the deposit (G26, L21), moving out with a deposit (G29) and budgets (G43).
// Throwaway database. Money is in paise (₹1 = 100); every number is worked out by hand in the test.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const now = new Date("2026-11-12T06:00:00Z");
let counter = 0;
const key = (tag: string) => `ob3-${tag}-${stamp}-${++counter}-abcdefgh`;

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
});

async function flat(names: string[], type = "home") {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `OB3 ${n} ${stamp}`, type, currency: "INR", inviteCode: `ob3-${n}-${stamp}`, members: { create: names.map((name, i) => ({ name, createdAt: new Date(2026, 0, i + 1) })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, ids: Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string> };
}
type Flat = Awaited<ReturnType<typeof flat>>;
const addMember = async (g: Flat, name: string) => {
  const m = await db.member.create({ data: { groupId: g.id, name } });
  g.ids[name] = m.id;
  return m.id;
};
const sharesOf = async (groupId: string) => Object.fromEntries((await db.depositShare.findMany({ where: { deposit: { groupId } } })).map((s) => [s.memberId, { amount: s.amount, status: s.status }]));
const heldTotal = async (groupId: string) =>
  (await db.depositShare.findMany({ where: { deposit: { groupId }, status: "held" } })).reduce((t, s) => t + s.amount, 0);
// What the Deposit page would carry as hidden v_<member> for these people, read now.
async function opened(g: Flat, names: string[]) {
  const rows = await db.depositShare.findMany({ where: { deposit: { groupId: g.id }, status: "held" } });
  return Object.fromEntries(names.map((n) => [g.ids[n], depositVersion(rows.find((r) => r.memberId === g.ids[n]))]));
}
const eventCount = (groupId: string) => db.groupEvent.count({ where: { groupId } });
const switchToUsd = (groupId: string) => db.group.update({ where: { id: groupId }, data: { currency: "USD" } });

describe("G26: a deposit save only changes the boxes that were on the form, and only if still as shown", () => {
  // Asha holds 3,600,000 (₹36,000) and Kabir 4,200,000 (₹42,000). Asha opens the form. Ravi then joins and saves 250,000 (₹2,500).
  async function scene() {
    const g = await flat(["Asha", "Kabir"]);
    expect((await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "42000" } })).ok).toBe(true);
    const form = await opened(g, ["Asha", "Kabir"]);
    await addMember(g, "Ravi");
    expect((await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Ravi]: "2500" } })).ok).toBe(true);
    expect(await sharesOf(g.id)).toEqual({
      [g.ids.Asha]: { amount: 3600000, status: "held" },
      [g.ids.Kabir]: { amount: 4200000, status: "held" },
      [g.ids.Ravi]: { amount: 250000, status: "held" },
    });
    return { g, form };
  }

  it("Asha saves her old form (no Ravi box): Ravi still holds 250,000 and 3,600,000 + 4,200,000 + 250,000 = 8,050,000 is held", async () => {
    const { g, form } = await scene();
    const events = await eventCount(g.id);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "42000" }, versions: form, heldByWas: "Landlord", currency: "INR" });
    expect(r.ok).toBe(true);
    expect((await sharesOf(g.id))[g.ids.Ravi]).toEqual({ amount: 250000, status: "held" });
    expect(await heldTotal(g.id)).toBe(8050000);
    expect(await eventCount(g.id)).toBe(events); // nothing changed: nothing in Activity
  });

  it("Asha clears Kabir's box (posted blank): only Kabir's share goes, 3,600,000 + 250,000 = 3,850,000 is held", async () => {
    const { g } = await scene();
    const form = await opened(g, ["Asha", "Kabir"]);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "" }, versions: form, heldByWas: "Landlord", currency: "INR" });
    expect(r.ok).toBe(true);
    expect((await sharesOf(g.id))[g.ids.Kabir]).toBeUndefined();
    expect(await heldTotal(g.id)).toBe(3850000);
  });

  it("a box typed as 0 clears the same way", async () => {
    const { g } = await scene();
    const form = await opened(g, ["Asha", "Kabir"]);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "0" }, versions: form, heldByWas: "Landlord", currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await heldTotal(g.id)).toBe(3850000);
  });

  it("Kabir changed himself to 4,500,000 after Asha opened the form, and Asha posts 4,000,000 for Kabir: refused, every row unchanged", async () => {
    const { g, form } = await scene();
    expect((await saveDepositFor(g.id, g.ids.Kabir, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "45000" } })).ok).toBe(true);
    const before = await sharesOf(g.id);
    const events = await eventCount(g.id);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "40000" }, versions: form, heldByWas: "Landlord", currency: "INR" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Kabir’s deposit changed to ₹45,000 since you opened this page, so nothing was saved. Look again and save once more.");
    expect(await sharesOf(g.id)).toEqual(before);
    expect(before[g.ids.Kabir]).toEqual({ amount: 4500000, status: "held" });
    expect(await eventCount(g.id)).toBe(events);
  });

  it("Kabir changed since, but Asha left his box as shown and changed only her own: Kabir's newer 4,500,000 stays", async () => {
    const { g, form } = await scene();
    expect((await saveDepositFor(g.id, g.ids.Kabir, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "45000" } })).ok).toBe(true);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "37000", [g.ids.Kabir]: "42000" }, versions: form, heldByWas: "Landlord", currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await sharesOf(g.id)).toMatchObject({ [g.ids.Asha]: { amount: 3700000 }, [g.ids.Kabir]: { amount: 4500000 }, [g.ids.Ravi]: { amount: 250000 } });
  });

  it("a form without the version fields (opened before this release) is refused once and writes nothing", async () => {
    const { g } = await scene();
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "37000" }, versions: {}, currency: "INR" });
    expect(r).toEqual({ ok: false, error: FORM_OUT_OF_DATE });
    expect((await sharesOf(g.id))[g.ids.Asha]).toEqual({ amount: 3600000, status: "held" });
  });
});

describe("J4: who holds the deposit is only written when it was edited and the stored name still matches", () => {
  async function scene() {
    const g = await flat(["Asha", "Ravi"]);
    expect((await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000" } })).ok).toBe(true);
    const form = await opened(g, ["Asha", "Ravi"]); // Asha's page: holder "Landlord", Asha 3,600,000, Ravi nothing
    // Ravi renames the holder meanwhile.
    expect((await saveDepositFor(g.id, g.ids.Ravi, { heldBy: "Mr Rao", amounts: {} })).ok).toBe(true);
    return { g, form };
  }
  const holder = async (gid: string) => (await db.deposit.findUniqueOrThrow({ where: { groupId: gid } })).heldBy;

  it("Asha saves an old page without touching the holder: her box is saved, the newer holder 'Mr Rao' stays", async () => {
    const { g, form } = await scene();
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", heldByWas: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Ravi]: "2500" }, versions: form, currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await holder(g.id)).toBe("Mr Rao");
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Asha]: { amount: 3600000, status: "held" }, [g.ids.Ravi]: { amount: 250000, status: "held" } });
    expect(await heldTotal(g.id)).toBe(3850000);
  });

  it("Asha edits the holder to 'Sharma' on an old page: refused, the holder and every share are unchanged", async () => {
    const { g, form } = await scene();
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Sharma", heldByWas: "Landlord", amounts: { [g.ids.Asha]: "36000" }, versions: form, currency: "INR" });
    expect(r).toEqual({ ok: false, error: "Who holds the deposit changed to Mr Rao since you opened this page, so nothing was saved. Look again and save once more." });
    expect(await holder(g.id)).toBe("Mr Rao");
    expect(await heldTotal(g.id)).toBe(3600000);
  });

  it("Asha edits the holder on a current page: it is saved", async () => {
    const { g } = await scene();
    const form = await opened(g, ["Asha", "Ravi"]);
    expect((await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Sharma", heldByWas: "Mr Rao", amounts: { [g.ids.Asha]: "36000" }, versions: form, currency: "INR" })).ok).toBe(true);
    expect(await holder(g.id)).toBe("Sharma");
  });

  it("an old page with no heldByWas is refused once", async () => {
    const { g, form } = await scene();
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000" }, versions: form, currency: "INR" });
    expect(r).toEqual({ ok: false, error: FORM_OUT_OF_DATE });
    expect(await holder(g.id)).toBe("Mr Rao");
  });
});

describe("L21: the deposit save and return re-check the currency inside the write", () => {
  it("the group switches INR to USD after the checks: the save is refused and the deposit rows are unchanged", async () => {
    const g = await flat(["Asha", "Kabir"]);
    await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "42000" } });
    const form = await opened(g, ["Asha", "Kabir"]);
    const r = await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "40000", [g.ids.Kabir]: "42000" }, versions: form, heldByWas: "Landlord", currency: "INR" }, { afterRead: async () => void (await switchToUsd(g.id)) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("currency changed to USD");
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Asha]: { amount: 3600000, status: "held" }, [g.ids.Kabir]: { amount: 4200000, status: "held" } });
  });

  it("the group switches after the checks while returning with deductions of 500: refused, nothing is marked returned", async () => {
    const g = await flat(["Asha", "Kabir"]);
    await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "42000" } });
    const r = await returnDepositFor(g.id, g.ids.Asha, "500", { currency: "INR", afterRead: async () => void (await switchToUsd(g.id)) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("currency changed to USD");
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Asha]: { amount: 3600000, status: "held" }, [g.ids.Kabir]: { amount: 4200000, status: "held" } });
  });

  it("returning in the right currency still works: deductions 500 (50,000 paise) of 7,800,000 held", async () => {
    const g = await flat(["Asha", "Kabir"]);
    await saveDepositFor(g.id, g.ids.Asha, { heldBy: "Landlord", amounts: { [g.ids.Asha]: "36000", [g.ids.Kabir]: "42000" } });
    const r = await returnDepositFor(g.id, g.ids.Asha, "500", { currency: "INR" });
    expect(r.ok).toBe(true);
    const s = await db.depositShare.findMany({ where: { deposit: { groupId: g.id } } });
    expect(s.every((x) => x.status === "returned")).toBe(true);
    // Back + kept = held: 7,800,000 = returned + 50,000 deducted.
    expect(s.reduce((t, x) => t + x.returnedAmount, 0) + 50000).toBe(7800000);
  });
});

describe("G29: moving out hands over exactly the deposit shown", () => {
  async function scene() {
    const g = await flat(["You", "Kabir", "Ravi"]);
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "42000", [g.ids.Ravi]: "2500" } })).ok).toBe(true);
    return g;
  }
  const out = (g: Flat, o: { depositTo?: string; expectDeposit?: string }, opts: Parameters<typeof moveOut>[4] = {}) =>
    moveOut(g.id, g.ids.You, { leaverId: g.ids.Kabir, lastDay: "2026-11-10", requestKey: key("mv"), ...o }, now, opts);
  const nothingHappened = async (g: Flat) => {
    expect((await db.member.findUniqueOrThrow({ where: { id: g.ids.Kabir } })).leftAt).toBeNull();
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "member_left" } })).toBe(0);
    await checkBooks(g.id);
  };

  it("the page showed 4,200,000, and Kabir's deposit was edited to 4,500,000 before the confirm: refused, no move-out, no payments, no events", async () => {
    const g = await scene();
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "45000" } })).ok).toBe(true);
    const r = await out(g, { depositTo: g.ids.Ravi, expectDeposit: "4200000" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Kabir’s deposit changed to ₹45,000 since you opened this page, so nothing was saved.");
    await nothingHappened(g);
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Kabir]: { amount: 4500000, status: "held" }, [g.ids.Ravi]: { amount: 250000, status: "held" } });
  });

  it("the edit lands between the read and the write: also refused, nothing handed on", async () => {
    const g = await scene();
    const r = await out(g, { depositTo: g.ids.Ravi, expectDeposit: "4200000" }, {
      afterRead: async () => void (await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "45000" } })),
    });
    expect(r.ok).toBe(false);
    await nothingHappened(g);
    expect((await sharesOf(g.id))[g.ids.Ravi]).toEqual({ amount: 250000, status: "held" });
  });

  it("J3: no hand-over (kept on record), and the deposit is edited to 4,500,000 in the gap: refused inside the write, Kabir is still in the flat", async () => {
    const g = await scene();
    const r = await out(g, { expectDeposit: "4200000" }, {
      afterRead: async () => void (await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.Kabir]: "45000" } })),
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Kabir’s deposit changed to ₹45,000 since you opened this page, so nothing was saved.");
    await nothingHappened(g);
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Kabir]: { amount: 4500000, status: "held" }, [g.ids.Ravi]: { amount: 250000, status: "held" } });
  });

  it("J3: no hand-over, deposit as shown: Kabir moves out and his 4,200,000 stays on record", async () => {
    const g = await scene();
    const r = await out(g, { expectDeposit: "4200000" });
    expect(r.ok).toBe(true);
    expect((await sharesOf(g.id))[g.ids.Kabir]).toEqual({ amount: 4200000, status: "held" });
    expect(await heldTotal(g.id)).toBe(4450000); // 4,200,000 + 250,000
    await checkBooks(g.id);
  });

  it("the person picked to take it moved out before the confirm: refused, and the hand-over is not dropped", async () => {
    const g = await scene();
    await db.member.update({ where: { id: g.ids.Ravi }, data: { leftAt: new Date("2026-11-09T00:00:00Z") } });
    const r = await out(g, { depositTo: g.ids.Ravi, expectDeposit: "4200000" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Ravi has moved out, so they can’t take over the deposit. Pick someone else.");
    await nothingHappened(g);
  });

  it("the person picked to take it moves out between the read and the write: refused the same way", async () => {
    const g = await scene();
    const r = await out(g, { depositTo: g.ids.Ravi, expectDeposit: "4200000" }, { afterRead: async () => void (await db.member.update({ where: { id: g.ids.Ravi }, data: { leftAt: new Date("2026-11-09T00:00:00Z") } })) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Ravi has moved out, so they can’t take over the deposit. Pick someone else.");
    await nothingHappened(g);
  });

  it("as shown, it is handed over exactly: Ravi 250,000 + Kabir's 4,200,000 = 4,450,000 held, nothing lost", async () => {
    const g = await scene();
    const r = await out(g, { depositTo: g.ids.Ravi, expectDeposit: "4200000" });
    expect(r.ok).toBe(true);
    expect(await sharesOf(g.id)).toEqual({ [g.ids.Kabir]: { amount: 4200000, status: "transferred" }, [g.ids.Ravi]: { amount: 4450000, status: "held" } });
    expect(await heldTotal(g.id)).toBe(4450000);
    await checkBooks(g.id);
  });
});

describe("G43: an old budgets form never clears or overwrites someone else's newer limit", () => {
  // Food is 800,000 (₹8,000). Bills is blank on Asha's form. Ravi then sets bills to 400,000 (₹4,000).
  async function scene() {
    const g = await flat(["Asha", "Ravi"], "couple");
    expect((await saveBudgetsFor(g.id, g.ids.Asha, { food: "8000" })).ok).toBe(true);
    const was = { food: "800000", bills: "" }; // what Asha's form showed
    expect((await saveBudgetsFor(g.id, g.ids.Ravi, { bills: "4000" })).ok).toBe(true);
    return { g, was };
  }
  const budgets = async (groupId: string) => Object.fromEntries((await db.budget.findMany({ where: { groupId } })).map((b) => [b.category, b.amount]));
  const budgetEvents = (groupId: string) => db.groupEvent.count({ where: { groupId, text: "updated the monthly budgets" } });

  it("Asha posts food 8,000 and bills blank as shown: bills stays 400,000, and there is no new Activity line", async () => {
    const { g, was } = await scene();
    const events = await budgetEvents(g.id);
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "8000", bills: "" }, { was, currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await budgets(g.id)).toEqual({ food: 800000, bills: 400000 });
    expect(await budgetEvents(g.id)).toBe(events);
  });

  it("Asha raises food to 9,000: food becomes 900,000 and bills stays 400,000", async () => {
    const { g, was } = await scene();
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "9000", bills: "" }, { was, currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await budgets(g.id)).toEqual({ food: 900000, bills: 400000 });
  });

  it("a form that showed bills 400,000 and posts it blank removes bills", async () => {
    const { g } = await scene();
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "8000", bills: "" }, { was: { food: "800000", bills: "400000" }, currency: "INR" });
    expect(r.ok).toBe(true);
    expect(await budgets(g.id)).toEqual({ food: 800000 });
  });

  it("food was changed to 850,000 since Asha's form showed 800,000, and she posts 9,000: refused, nothing written", async () => {
    const { g, was } = await scene();
    await saveBudgetsFor(g.id, g.ids.Ravi, { food: "8500" });
    const events = await budgetEvents(g.id);
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "9000", bills: "" }, { was, currency: "INR" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("Bites & Sips changed to ₹8,500 since you opened this page, so nothing was saved.");
    expect(await budgets(g.id)).toEqual({ food: 850000, bills: 400000 });
    expect(await budgetEvents(g.id)).toBe(events);
  });

  it("the currency changes in the gap: refused, no budget or event rows written", async () => {
    const { g, was } = await scene();
    const events = await budgetEvents(g.id);
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "9000", bills: "" }, { was, currency: "INR", afterRead: async () => void (await switchToUsd(g.id)) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("currency changed to USD");
    expect(await budgets(g.id)).toEqual({ food: 800000, bills: 400000 });
    expect(await budgetEvents(g.id)).toBe(events);
  });

  it("a form without the was_ fields (opened before this release) is refused once", async () => {
    const { g } = await scene();
    const r = await saveBudgetsFor(g.id, g.ids.Asha, { food: "9000" }, { was: {}, currency: "INR" });
    expect(r).toEqual({ ok: false, error: FORM_OUT_OF_DATE });
    expect(await budgets(g.id)).toEqual({ food: 800000, bills: 400000 });
  });
});
