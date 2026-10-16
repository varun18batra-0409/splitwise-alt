import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { usualItems } from "@/lib/home/list";
import { addListItem, buyListItems, toggleListItem } from "@/lib/home/list-db";

// The shared shopping list: add, tick when bought, then one expense for the lot.

describe("usual items", () => {
  it("suggests the most-added things that aren't on the list now", () => {
    const history = ["Milk", "milk", "Bread", "Eggs", "Eggs", "Eggs", "Onions", "bread", "Milk "];
    expect(usualItems(history, ["eggs"])).toEqual(["Milk", "Bread", "Onions"]);
    expect(usualItems([], [])).toEqual([]);
  });
});

describe("buying from the list", () => {
  let groupId = "", you = "", asha = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Flat", type: "home", currency: "INR", inviteCode: `list-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }] } },
      include: { members: true },
    });
    groupId = g.id;
    you = g.members.find((m) => m.name === "You")!.id;
    asha = g.members.find((m) => m.name === "Asha")!.id;
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("only people in the group can add, and empty text is ignored", async () => {
    expect((await addListItem(groupId, "stranger", "Milk")).ok).toBe(false);
    expect((await addListItem(groupId, you, "   ")).ok).toBe(false);
  });

  it("ticked items become one groceries expense with the items in the note", async () => {
    const a = await addListItem(groupId, asha, "Milk 2 L");
    const b = await addListItem(groupId, you, "Onions 1 kg");
    await addListItem(groupId, you, "Dishwash liquid");
    if (!a.ok || !b.ok) throw new Error("add failed");
    await toggleListItem(groupId, you, a.id);
    await toggleListItem(groupId, you, b.id);
    const key = `buy-${Date.now()}-abcdefgh`;
    const r1 = await buyListItems(groupId, you, "1240", key);
    const r2 = await buyListItems(groupId, you, "1240", key);
    expect(r1.ok && r2.ok && r1.id === r2.id).toBe(true);
    const e = await db.expense.findMany({ where: { groupId }, include: { shares: true } });
    expect(e.length).toBe(1);
    expect([e[0].amount, e[0].category, e[0].paidById, e[0].notes]).toEqual([124000, "groceries", you, "Milk 2 L, Onions 1 kg"]);
    const open = await db.listItem.findMany({ where: { groupId, expenseId: "" } });
    expect(open.map((i) => i.text)).toEqual(["Dishwash liquid"]);
  });

  it("nothing ticked: nothing to add", async () => {
    expect(await buyListItems(groupId, asha, "100", `buy2-${Date.now()}-abcdefgh`)).toEqual({ ok: false, error: "Tick what you bought first." });
  });
});
