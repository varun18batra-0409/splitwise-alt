import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { moveOut, returnDepositFor, saveDepositFor } from "@/lib/home/moving-db";

// SEQ-FEAT-03 and SEQ-FEAT-04: the deposit is never handed on twice, and a stale deposit form can't bring a
// returned deposit back to life.
//
// Hand-worked: ₹200 = 20000 paise each for L1, L2 and R. L1 and L2 both move out and hand their deposit to R.
// Done one after the other, R holds 20000 + 20000 + 20000 = 60000. Never 40000 (which would lose one hand-over).

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const now = new Date("2026-11-12T06:00:00Z");
let counter = 0;

async function flat(names: string[]) {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `Deposit ${n} ${stamp}`, type: "home", currency: "INR", inviteCode: `dep-${n}-${stamp}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, ids: Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string> };
}
const sharesOf = async (groupId: string) => Object.fromEntries((await db.depositShare.findMany({ where: { deposit: { groupId } } })).map((s) => [s.memberId, { amount: s.amount, status: s.status }]));
const key = (tag: string) => `dep-${tag}-${stamp}-abcdefgh`;

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("two people moving out at the same moment, both handing their deposit to R", () => {
  let g: Awaited<ReturnType<typeof flat>>;
  beforeAll(async () => {
    g = await flat(["You", "L1", "L2", "R"]);
    const r = await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.L1]: "200", [g.ids.L2]: "200", [g.ids.R]: "200" } });
    expect(r.ok).toBe(true);
  });

  it("the second move-out lands while the first is between reading and writing: R ends with 60000, not 40000", async () => {
    const second = { ok: false as boolean };
    const first = await moveOut(g.id, g.ids.You, { leaverId: g.ids.L1, lastDay: "2026-11-10", depositTo: g.ids.R, requestKey: key("one") }, now, {
      afterRead: async () => {
        const r = await moveOut(g.id, g.ids.You, { leaverId: g.ids.L2, lastDay: "2026-11-10", depositTo: g.ids.R, requestKey: key("two") }, now);
        second.ok = r.ok;
      },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const s = await sharesOf(g.id);
    expect(s[g.ids.R]).toEqual({ amount: 60000, status: "held" });
    expect(s[g.ids.L1].status).toBe("transferred");
    expect(s[g.ids.L2].status).toBe("transferred");
    // Nothing lost or made up: what is held now (R's 60000) is what L1, L2 and R put in (3 x 20000).
    const held = Object.values(s).filter((x) => x.status === "held").reduce((t, x) => t + x.amount, 0);
    expect(held).toBe(60000);
  });
});

describe("a move-out whose deposit was returned in the gap is refused", () => {
  it("L1's deposit is returned between the read and the write: the move-out is refused, L1 is still in the flat, nothing is handed on", async () => {
    const g = await flat(["You", "L1", "R"]);
    await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.L1]: "200", [g.ids.R]: "200" } });
    const r = await moveOut(g.id, g.ids.You, { leaverId: g.ids.L1, lastDay: "2026-11-10", depositTo: g.ids.R, requestKey: key("gap") }, now, {
      afterRead: async () => {
        expect((await returnDepositFor(g.id, g.ids.You, "")).ok).toBe(true);
      },
    });
    expect(r.ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: g.ids.L1 } })).leftAt).toBeNull();
    const s = await sharesOf(g.id);
    expect(s[g.ids.L1].status).toBe("returned");
    expect(s[g.ids.R].status).toBe("returned");
    expect(s[g.ids.R].amount).toBe(20000); // not 40000
  });
});

describe("a stale deposit form", () => {
  it("A's deposit was fully returned; saving 200 for A afterwards is refused and A stays returned", async () => {
    const g = await flat(["You", "A"]);
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.A]: "100" } })).ok).toBe(true);
    expect((await returnDepositFor(g.id, g.ids.You, "")).ok).toBe(true);
    const r = await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.A]: "200" } });
    expect(r.ok).toBe(false);
    expect((await sharesOf(g.id))[g.ids.A]).toEqual({ amount: 10000, status: "returned" });
  });
  it("a normal save still works: A 100 then 150 is 15000 held", async () => {
    const g = await flat(["You", "A"]);
    await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.A]: "100" } });
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.A]: "150" } })).ok).toBe(true);
    expect((await sharesOf(g.id))[g.ids.A]).toEqual({ amount: 15000, status: "held" });
  });
});

describe("saving the form keeps a leaver's deposit on record", () => {
  it("Kabir moved out with 20000 held; saving the form for the others leaves his 20000 held, and a cleared box still removes that person's share", async () => {
    const g = await flat(["You", "Asha", "Kabir"]);
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.You]: "100", [g.ids.Asha]: "100", [g.ids.Kabir]: "200" } })).ok).toBe(true);
    // Kabir moves out and keeps his deposit on record (no one to hand it to).
    expect((await moveOut(g.id, g.ids.You, { leaverId: g.ids.Kabir, lastDay: "2026-11-10", requestKey: key("kabir") }, now)).ok).toBe(true);
    // The form has boxes for You and Asha only; Asha's is cleared.
    expect((await saveDepositFor(g.id, g.ids.You, { heldBy: "Landlord", amounts: { [g.ids.You]: "150", [g.ids.Asha]: "" } })).ok).toBe(true);
    const s = await sharesOf(g.id);
    expect(s[g.ids.Kabir]).toEqual({ amount: 20000, status: "held" });
    expect(s[g.ids.You]).toEqual({ amount: 15000, status: "held" });
    expect(s[g.ids.Asha]).toBeUndefined();
    // The Activity line shows what is held after the save: You 15000 + Kabir 20000 = 35000, which is ₹350 (not just the 15000 typed).
    const last = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, text: { startsWith: "updated the deposit" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(last.text).toBe("updated the deposit with Landlord (₹350)");
  });
});

