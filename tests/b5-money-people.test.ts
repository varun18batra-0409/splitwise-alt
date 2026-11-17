import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { LEAVER_DEPOSIT_ERROR, saveDepositFor } from "@/lib/home/moving-db";
import { memberInUseText, removeMembers } from "@/lib/undo";
import { removeOrKeepPerson } from "@/lib/remove-person";
import { addListItem, buyListItems } from "@/lib/home/list-db";

// B5 part C (money and people). Every group is made fresh; the money is in paise, worked out by hand below.
//
// Deposit of someone who moved out. Held: A 36000 rupees = 3600000 paise, B 3600000, C (moved out) 3600000.
//   Total held 3 x 3600000 = 10800000. B posts { A: "36000", B: "36000", C: "1" }: refused, nothing changes, still 10800000.
//   Without C's box ({ A, B } only) the save goes through and C's share is never touched: still 10800000.
//
// Undo of "added Kiran": refused while Kiran is named in a deposit (1000000), a goal entry (50000), a pot move (200000),
//   a game (host or player) or a bill (payer or turn list). The row and the money stay exactly as they were.
//   Kiran with nothing is removed.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let counter = 0;

afterAll(async () => {
  await db.potGame.deleteMany({ where: { groupId: { in: groupIds } } }); // games have no link to the group, so they are not removed with it
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

async function flat(names: string[], type = "home") {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `B5 ${n} ${stamp}`, type, currency: "INR", inviteCode: `b5mp-${n}-${stamp}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, ids: Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string> };
}
const shares = async (groupId: string) =>
  Object.fromEntries((await db.depositShare.findMany({ where: { deposit: { groupId } } })).map((s) => [s.memberId, { amount: s.amount, status: s.status }]));
const held = async (groupId: string) => (await db.depositShare.aggregate({ where: { deposit: { groupId }, status: "held" }, _sum: { amount: true } }))._sum.amount ?? 0;

describe("C4: nobody can change the deposit of someone who moved out", () => {
  it("a form with a box for the leaver is refused, and every share stays", async () => {
    const f = await flat(["A", "B", "C"]);
    const first = await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "36000" } });
    expect(first.ok).toBe(true);
    expect(await held(f.id)).toBe(10800000);
    await db.member.update({ where: { id: f.ids.C }, data: { leftAt: new Date("2026-11-10T00:00:00Z") } });
    const before = await shares(f.id);

    const r = await saveDepositFor(f.id, f.ids.B, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "1" } });
    expect(r).toEqual({ ok: false, error: LEAVER_DEPOSIT_ERROR });
    expect(LEAVER_DEPOSIT_ERROR).toBe("That person has moved out, so their deposit can’t be changed here.");
    expect(await shares(f.id)).toEqual(before);
    expect(await held(f.id)).toBe(10800000);
    // Shares add up to the total held: 3600000 x 3.
    expect(Object.values(before).reduce((s, x) => s + x.amount, 0)).toBe(10800000);
  });

  it("a form without the leaver's box still saves, and the leaver's share is untouched", async () => {
    const f = await flat(["A", "B", "C"]);
    await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "36000" } });
    await db.member.update({ where: { id: f.ids.C }, data: { leftAt: new Date("2026-11-10T00:00:00Z") } });
    const r = await saveDepositFor(f.id, f.ids.B, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000" } });
    expect(r.ok).toBe(true);
    expect(await shares(f.id)).toEqual({
      [f.ids.A]: { amount: 3600000, status: "held" },
      [f.ids.B]: { amount: 3600000, status: "held" },
      [f.ids.C]: { amount: 3600000, status: "held" },
    });
    expect(await held(f.id)).toBe(10800000);
  });

  it("an id from another group is still skipped, and a blank box for the leaver is ignored", async () => {
    const f = await flat(["A", "B", "C"]);
    const other = await flat(["X"]);
    await db.member.update({ where: { id: f.ids.C }, data: { leftAt: new Date("2026-11-10T00:00:00Z") } });
    const r = await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.C]: "  ", [other.ids.X]: "99" } });
    expect(r.ok).toBe(true);
    expect(await shares(f.id)).toEqual({ [f.ids.A]: { amount: 3600000, status: "held" } });
  });
});

describe("C8: undo of \"added\" never leaves money or games pointing at nobody", () => {
  const exists = (id: string) => db.member.count({ where: { id } });

  it("the words are the approved ones", () => {
    expect(memberInUseText("Kiran")).toBe("Kiran is already part of expenses, payments, moments, the deposit, a goal or a game, so they can’t be removed.");
  });

  it("a deposit share (1000000) stops it; the row and the share stay", async () => {
    const f = await flat(["Asha", "Kiran"]);
    await saveDepositFor(f.id, f.ids.Asha, { heldBy: "Landlord", amounts: { [f.ids.Kiran]: "10000" } });
    expect(await held(f.id)).toBe(1000000);
    const r = await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true);
    expect(r).toEqual({ ok: false, error: memberInUseText("Kiran") });
    expect(await exists(f.ids.Kiran)).toBe(1);
    expect(await shares(f.id)).toEqual({ [f.ids.Kiran]: { amount: 1000000, status: "held" } });
  });

  it("a hand-over target (toMemberId) stops it too", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"]);
    const dep = await db.deposit.create({ data: { groupId: f.id } });
    await db.depositShare.create({ data: { depositId: dep.id, memberId: f.ids.Ben, amount: 1000000, status: "transferred", toMemberId: f.ids.Kiran } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    expect(await exists(f.ids.Kiran)).toBe(1);
  });

  it("a goal entry (50000) stops it", async () => {
    const f = await flat(["Asha", "Kiran"]);
    const goal = await db.goal.create({ data: { groupId: f.id, name: "Sofa", target: 5000000 } });
    await db.goalEntry.create({ data: { goalId: goal.id, memberId: f.ids.Kiran, amount: 50000 } });
    expect(await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).toEqual({ ok: false, error: memberInUseText("Kiran") });
    expect(await exists(f.ids.Kiran)).toBe(1);
    expect(await db.goalEntry.count({ where: { goalId: goal.id } })).toBe(1);
  });

  it("a pot move (200000) stops it", async () => {
    const f = await flat(["Asha", "Kiran"], "pot");
    const game = await db.potGame.create({ data: { groupId: f.id, name: "Friday", hostId: f.ids.Asha, players: JSON.stringify([f.ids.Asha]) } });
    await db.potMove.create({ data: { gameId: game.id, memberId: f.ids.Kiran, kind: "take", amount: 200000, createdById: f.ids.Asha } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    expect(await exists(f.ids.Kiran)).toBe(1);
    expect(await db.potMove.count({ where: { gameId: game.id } })).toBe(1);
  });

  it("a game he hosts, or plays in, stops it", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"], "pot");
    const hosted = await db.potGame.create({ data: { groupId: f.id, name: "Hosted", hostId: f.ids.Kiran, players: JSON.stringify([f.ids.Kiran]) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    await db.potGame.delete({ where: { id: hosted.id } });
    await db.potGame.create({ data: { groupId: f.id, name: "Played", hostId: f.ids.Asha, players: JSON.stringify([f.ids.Asha, f.ids.Kiran]) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    expect(await exists(f.ids.Kiran)).toBe(1);
  });

  it("a bill he pays, or takes turns on, stops it", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"]);
    const bill = await db.bill.create({ data: { groupId: f.id, name: "Electricity", startMonth: "2026-11", payer: f.ids.Kiran } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    await db.bill.update({ where: { id: bill.id }, data: { payer: "", rotation: JSON.stringify([f.ids.Ben, f.ids.Kiran]) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    expect(await exists(f.ids.Kiran)).toBe(1);
  });

  it("Kiran with nothing is removed; someone else's deposit does not hold him", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"]);
    await saveDepositFor(f.id, f.ids.Asha, { heldBy: "Landlord", amounts: { [f.ids.Ben]: "10000" } });
    const r = await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true);
    expect(r.ok).toBe(true);
    expect(await exists(f.ids.Kiran)).toBe(0);
    expect(await held(f.id)).toBe(1000000); // Ben's deposit untouched
  });
});

// Review fixes after C1 to C9.
//
// Hand-worked: deposit 10000 rupees = 1000000 paise for Kiran. Bill Rent 50000 rupees = 5000000 paise split percent
// Asha 6000 (60.00%) + Kiran 4000 (40.00%) in basis points: 6000 + 4000 = 10000 = 100%.
describe("review 1: Remove person keeps someone who is named anywhere as history", () => {
  it("Kiran with only a deposit share (1000000) is removed and kept; the share stays", async () => {
    const f = await flat(["Asha", "Kiran"]);
    await saveDepositFor(f.id, f.ids.Asha, { heldBy: "Landlord", amounts: { [f.ids.Kiran]: "10000" } });
    const r = await removeOrKeepPerson(f.id, f.ids.Asha, f.ids.Kiran);
    expect(r.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.ids.Kiran } });
    expect(row.removedAt).not.toBeNull();
    expect(await shares(f.id)).toEqual({ [f.ids.Kiran]: { amount: 1000000, status: "held" } });
  });

  it("Kiran with nothing is deleted completely", async () => {
    const f = await flat(["Asha", "Kiran"]);
    const r = await removeOrKeepPerson(f.id, f.ids.Asha, f.ids.Kiran);
    expect(r.ok).toBe(true);
    expect(await db.member.count({ where: { id: f.ids.Kiran } })).toBe(0);
  });
});

describe("review 2: a bill's split names the person", () => {
  it("percent split { Asha: 6000, Kiran: 4000 } blocks undo of added Kiran", async () => {
    const f = await flat(["Asha", "Kiran"]);
    await db.bill.create({ data: { groupId: f.id, name: "Rent", startMonth: "2026-11", payer: f.ids.Asha, split: JSON.stringify({ mode: "percent", pct: { [f.ids.Asha]: 6000, [f.ids.Kiran]: 4000 } }) } });
    expect(await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).toEqual({ ok: false, error: memberInUseText("Kiran") });
    expect(await db.member.count({ where: { id: f.ids.Kiran } })).toBe(1);
  });

  it("an amounts split and a 'some' list block it too; a split that names only others does not", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"]);
    const bill = await db.bill.create({ data: { groupId: f.id, name: "Net", startMonth: "2026-11", payer: f.ids.Asha, split: JSON.stringify({ mode: "amounts", amt: { [f.ids.Asha]: 100000, [f.ids.Kiran]: 50000 } }) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    await db.bill.update({ where: { id: bill.id }, data: { split: JSON.stringify({ mode: "some", ids: [f.ids.Asha, f.ids.Kiran] }) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    await db.bill.update({ where: { id: bill.id }, data: { split: JSON.stringify({ mode: "some", ids: [f.ids.Asha, f.ids.Ben] }) } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(true);
  });

  it("a shopping-list item (added or ticked) names the person too", async () => {
    const f = await flat(["Asha", "Kiran", "Ben"]);
    await db.listItem.create({ data: { groupId: f.id, text: "Milk", addedById: f.ids.Kiran } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true)).ok).toBe(false);
    await db.listItem.create({ data: { groupId: f.id, text: "Eggs", addedById: f.ids.Asha, boughtById: f.ids.Ben } });
    expect((await removeMembers(f.id, f.ids.Asha, [f.ids.Ben], true)).ok).toBe(false); // ticked as bought by Ben
  });

  it("a moment reaction alone names the person (the photo is Ben's, the reaction is Asha's)", async () => {
    const f = await flat(["Asha", "Ben"]);
    const moment = await db.moment.create({ data: { groupId: f.id, authorId: f.ids.Ben, authorAccountId: "acct-x", data: Buffer.from([]), thumbData: Buffer.from([]) } });
    await db.momentReaction.create({ data: { momentId: moment.id, memberId: f.ids.Asha, emoji: "x" } });
    expect(await removeMembers(f.id, f.ids.Ben, [f.ids.Asha], true)).toEqual({ ok: false, error: memberInUseText("Asha") });
    expect(await db.member.count({ where: { id: f.ids.Asha } })).toBe(1);
  });
});

describe("review 3: the re-checks inside the write are really tested", () => {
  it("C4: C moves out between the read and the save, B cleared C's box: C's share (3600000) stays", async () => {
    const f = await flat(["A", "B", "C"]);
    await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "36000" } });
    const r = await saveDepositFor(f.id, f.ids.B, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "" } }, {
      afterRead: async () => {
        await db.member.update({ where: { id: f.ids.C }, data: { leftAt: new Date() } });
      },
    });
    expect(r.ok).toBe(true);
    expect((await shares(f.id))[f.ids.C]).toEqual({ amount: 3600000, status: "held" });
    expect(await held(f.id)).toBe(10800000);
  });

  it("C4: C moves out between the read and the save while C's box still has 36000: refused, nothing changes (10800000 held)", async () => {
    const f = await flat(["A", "B", "C"]);
    await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "36000" } });
    const r = await saveDepositFor(f.id, f.ids.B, { heldBy: "Landlord", amounts: { [f.ids.A]: "30000", [f.ids.B]: "42000", [f.ids.C]: "36000" } }, {
      afterRead: async () => {
        await db.member.update({ where: { id: f.ids.C }, data: { leftAt: new Date() } });
      },
    });
    expect(r).toEqual({ ok: false, error: LEAVER_DEPOSIT_ERROR });
    expect((await shares(f.id))[f.ids.A]).toEqual({ amount: 3600000, status: "held" });
    expect(await held(f.id)).toBe(10800000);
  });

  it("C4: Kiran is removed (deleted) between the read and the save: refused, no share for a person who no longer exists", async () => {
    const f = await flat(["Asha", "Kiran"]);
    const r = await saveDepositFor(f.id, f.ids.Asha, { heldBy: "Landlord", amounts: { [f.ids.Asha]: "10000", [f.ids.Kiran]: "10000" } }, {
      afterRead: async () => {
        await db.member.delete({ where: { id: f.ids.Kiran } });
      },
    });
    expect(r.ok).toBe(false);
    expect(await shares(f.id)).toEqual({});
    expect(await held(f.id)).toBe(0);
  });

  it("C4 control: nobody moves out, so a cleared box does remove C's held share (7200000 left)", async () => {
    const f = await flat(["A", "B", "C"]);
    await saveDepositFor(f.id, f.ids.A, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "36000" } });
    await saveDepositFor(f.id, f.ids.B, { heldBy: "Landlord", amounts: { [f.ids.A]: "36000", [f.ids.B]: "36000", [f.ids.C]: "" } });
    expect(await held(f.id)).toBe(7200000);
  });

  it("C8: a deposit share for Kiran lands between the read and the delete: refused, Kiran stays, share stays", async () => {
    const f = await flat(["Asha", "Kiran"]);
    const r = await removeMembers(f.id, f.ids.Asha, [f.ids.Kiran], true, undefined, {
      afterRead: async () => {
        await saveDepositFor(f.id, f.ids.Asha, { heldBy: "Landlord", amounts: { [f.ids.Kiran]: "10000" } });
      },
    });
    expect(r).toEqual({ ok: false, error: memberInUseText("Kiran") });
    expect(await db.member.count({ where: { id: f.ids.Kiran } })).toBe(1);
    expect(await shares(f.id)).toEqual({ [f.ids.Kiran]: { amount: 1000000, status: "held" } });
  });
});

describe("review 4: the shopping list in a deleted group", () => {
  it("adding and buying are refused with the usual wording; an open group still works", async () => {
    const f = await flat(["Asha", "Ben"]);
    expect((await addListItem(f.id, f.ids.Asha, "Milk")).ok).toBe(true);
    await db.group.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    expect(await addListItem(f.id, f.ids.Asha, "Eggs")).toEqual({ ok: false, error: "This group no longer exists." });
    expect(await buyListItems(f.id, f.ids.Asha, "100", `del-${stamp}-abcdefgh`)).toEqual({ ok: false, error: "This group no longer exists." });
    expect(await db.listItem.count({ where: { groupId: f.id } })).toBe(1);
  });
});
