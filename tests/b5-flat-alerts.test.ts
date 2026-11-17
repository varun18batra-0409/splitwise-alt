import { afterAll, describe, expect, it, vi } from "vitest";

// B5 GP-10: the shopping list in a closed flat. Add, tick, remove, "I bought these" and "Going shopping?" each say why
// they did nothing, change nothing and send nothing. A flat that is open still works (the control cases).
// No money moves here: the ticked items stay un-bought, and no Groceries expense is made in the closed flat (0 expenses).

const state = vi.hoisted(() => ({ pushes: [] as { ids: string[] }[] }));
vi.mock("@/lib/push", async (orig) => ({
  ...(await orig<typeof import("@/lib/push")>()),
  sendPushTo: async (ids: string[]) => {
    state.pushes.push({ ids });
    return 1;
  },
}));

const { db } = await import("@/lib/db");
const { CLOSED_LIST_ERROR } = await import("@/lib/active");
const { addListItem, buyListItems, goingShopping, removeListItem, toggleListItem } = await import("@/lib/home/list-db");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let counter = 0;
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

async function flat(closed: boolean) {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `B5 list ${n} ${stamp}`, type: "home", currency: "INR", closed, closedAt: closed ? new Date() : null, inviteCode: `b5l-${n}-${stamp}`, members: { create: [{ name: "Asha" }, { name: "Ravi" }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, a: g.members.find((m) => m.name === "Asha")!.id, r: g.members.find((m) => m.name === "Ravi")!.id };
}

describe("GP-10: the list in a closed flat", () => {
  it("the words are the approved ones", () => {
    expect(CLOSED_LIST_ERROR).toBe("This group is closed. Reopen it to use the list.");
  });

  it("add, tick and remove each refuse, and the item is unchanged", async () => {
    const f = await flat(false);
    const added = await addListItem(f.id, f.a, "Milk");
    if (!added.ok) throw new Error("add failed");
    await db.group.update({ where: { id: f.id }, data: { closed: true, closedAt: new Date() } });

    expect(await addListItem(f.id, f.a, "Bread")).toEqual({ ok: false, error: CLOSED_LIST_ERROR });
    expect(await toggleListItem(f.id, f.r, added.id)).toEqual({ ok: false, error: CLOSED_LIST_ERROR });
    expect(await removeListItem(f.id, f.r, added.id)).toEqual({ ok: false, error: CLOSED_LIST_ERROR });

    const rows = await db.listItem.findMany({ where: { groupId: f.id } });
    expect(rows.map((i) => [i.text, i.boughtAt, i.boughtById, i.expenseId])).toEqual([["Milk", null, "", ""]]);
  });

  it("buying ticked items refuses, and makes no expense", async () => {
    const f = await flat(false);
    const added = await addListItem(f.id, f.a, "Rice");
    if (!added.ok) throw new Error("add failed");
    await toggleListItem(f.id, f.a, added.id);
    await db.group.update({ where: { id: f.id }, data: { closed: true, closedAt: new Date() } });
    expect(await buyListItems(f.id, f.a, "500", `b5buy-${stamp}-abcdefgh`)).toEqual({ ok: false, error: CLOSED_LIST_ERROR });
    expect(await db.expense.count({ where: { groupId: f.id } })).toBe(0);
    expect((await db.listItem.findUniqueOrThrow({ where: { id: added.id } })).expenseId).toBe("");
  });

  it("Going shopping sends 0 messages in a closed flat, and 1 in an open one", async () => {
    const closed = await flat(true);
    state.pushes.length = 0;
    expect(await goingShopping(closed.id, closed.a)).toEqual({ ok: false, error: CLOSED_LIST_ERROR });
    expect(state.pushes.length).toBe(0);

    const open = await flat(false);
    expect((await goingShopping(open.id, open.a)).ok).toBe(true);
    expect(state.pushes).toEqual([{ ids: [open.r] }]); // Ravi only; Asha, who asked, is not told
  });

  it("an open flat still adds, ticks and removes", async () => {
    const f = await flat(false);
    const added = await addListItem(f.id, f.a, "Eggs");
    if (!added.ok) throw new Error("add failed");
    expect((await toggleListItem(f.id, f.r, added.id)).ok).toBe(true);
    expect((await removeListItem(f.id, f.r, added.id)).ok).toBe(true);
    expect(await db.listItem.count({ where: { groupId: f.id } })).toBe(0);
  });
});
