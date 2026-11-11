import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { moveOut, saveDepositFor } from "@/lib/home/moving-db";
import { undoEvent } from "@/lib/undo";

// Fable F31: undoing a move-out brings back the bills they paid or took turns
// on and the deposit they handed over, not only the person.
describe("undo a move-out", () => {
  let groupId = "";
  let you = "";
  let rohan = "";
  let meera = "";
  let wifi = "";
  let milk = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Flat U", type: "home", currency: "INR", inviteCode: `mvu-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Rohan" }, { name: "Meera" }] } },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    [you, rohan, meera] = [id("You"), id("Rohan"), id("Meera")];
    // Rohan pays the Wi-Fi; the milk goes round all three.
    wifi = (await db.bill.create({ data: { groupId, name: "Wi-Fi", nature: "fixed", amount: 100000, day: 5, startMonth: "2026-10", payer: rohan } })).id;
    milk = (await db.bill.create({ data: { groupId, name: "Milk", nature: "fixed", amount: 60000, day: 1, startMonth: "2026-10", payer: "", rotation: JSON.stringify([you, rohan, meera]) } })).id;
    // Deposit: You ₹30,000, Rohan ₹30,000 (Meera none yet).
    const r = await saveDepositFor(groupId, you, { heldBy: "Landlord", amounts: { [you]: "30000", [rohan]: "30000" } });
    expect(r.ok).toBe(true);
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("moves out, hands the deposit to Meera; undo puts bills and deposit back", async () => {
    const now = new Date("2026-10-20T06:00:00Z");
    const r = await moveOut(groupId, you, { leaverId: rohan, lastDay: "2026-10-20", depositTo: meera, requestKey: `mvu-${Date.now()}-abcdefgh` }, now);
    expect(r.ok).toBe(true);

    // After the move-out: Wi-Fi paid by You, Rohan out of the milk turns, deposit with Meera.
    expect((await db.bill.findUnique({ where: { id: wifi } }))!.payer).toBe(you);
    expect(JSON.parse((await db.bill.findUnique({ where: { id: milk } }))!.rotation)).toEqual([you, meera]);
    let shares = await db.depositShare.findMany({ where: { deposit: { groupId } } });
    expect(shares.find((s) => s.memberId === rohan)).toMatchObject({ status: "transferred", toMemberId: meera });
    expect(shares.find((s) => s.memberId === meera)).toMatchObject({ amount: 3000000, status: "held" });

    const ev = await db.groupEvent.findFirst({ where: { groupId, kind: "member_left" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(ev!.id, you);
    expect(u.ok).toBe(true);

    expect((await db.member.findUnique({ where: { id: rohan } }))!.leftAt).toBeNull();
    expect((await db.bill.findUnique({ where: { id: wifi } }))!.payer).toBe(rohan);
    expect(JSON.parse((await db.bill.findUnique({ where: { id: milk } }))!.rotation)).toEqual([you, rohan, meera]);
    shares = await db.depositShare.findMany({ where: { deposit: { groupId } } });
    expect(shares.find((s) => s.memberId === rohan)).toMatchObject({ amount: 3000000, status: "held", toMemberId: "" });
    expect(shares.find((s) => s.memberId === meera)).toBeUndefined(); // she had none before
    expect(shares.find((s) => s.memberId === you)).toMatchObject({ amount: 3000000, status: "held" });
  });

  it("a deposit changed since blocks the undo (money is never in two places)", async () => {
    const now = new Date("2026-10-21T06:00:00Z");
    const r = await moveOut(groupId, you, { leaverId: rohan, lastDay: "2026-10-21", depositTo: meera, requestKey: `mvu2-${Date.now()}-abcdefgh` }, now);
    expect(r.ok).toBe(true);
    // Meera's share is changed afterwards.
    await db.depositShare.updateMany({ where: { deposit: { groupId }, memberId: meera }, data: { amount: 1 } });
    const ev = await db.groupEvent.findFirst({ where: { groupId, kind: "member_left" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(ev!.id, you);
    expect(u.ok).toBe(false);
    expect((await db.member.findUnique({ where: { id: rohan } }))!.leftAt).not.toBeNull();
    // And the undo can be tried again later (not used up).
    expect((await db.groupEvent.findUnique({ where: { id: ev!.id } }))!.undoneAt).toBeNull();
  });
});

// Reviewer gaps: two people pressing at the same moment.
describe("two at once", () => {
  it("two flatmates confirming the same move-out: one goes through, once", async () => {
    const g = await db.group.create({
      data: { name: "Flat T", type: "home", currency: "INR", inviteCode: `mvt-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Rohan" }, { name: "Meera" }] } },
      include: { members: true },
    });
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const now = new Date("2026-10-20T06:00:00Z");
    // (A clash may also show up as a database "busy" error for the second one: also not a second move-out.)
    const all = await Promise.allSettled([
      moveOut(g.id, id("You"), { leaverId: id("Rohan"), lastDay: "2026-10-20", requestKey: `mvt1-${Date.now()}-abcdefgh` }, now),
      moveOut(g.id, id("Meera"), { leaverId: id("Rohan"), lastDay: "2026-10-20", requestKey: `mvt2-${Date.now()}-abcdefgh` }, now),
    ]);
    expect(all.filter((x) => x.status === "fulfilled" && x.value.ok)).toHaveLength(1);
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "member_left" } })).toBe(1);
    await db.group.delete({ where: { id: g.id } });
  });
});
