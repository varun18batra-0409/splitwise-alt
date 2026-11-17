import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { LIST_CLOSED, addListItem, goingShopping, removeListItem, toggleListItem } from "@/lib/home/list-db";

// A closed flat keeps its shopping list as it was: nothing is added, ticked, removed or announced, and the refusal says why.

describe("shopping list in a closed group", () => {
  let groupId = "", you = "", itemId = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Flat", type: "home", currency: "INR", inviteCode: `listc-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }] } },
      include: { members: true },
    });
    groupId = g.id;
    you = g.members.find((m) => m.name === "You")!.id;
    const a = await addListItem(groupId, you, "Bread");
    if (!a.ok) throw new Error("add failed");
    itemId = a.id;
    await db.group.update({ where: { id: groupId }, data: { closed: true, closedAt: new Date() } });
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("add, tick, remove and going-shopping are all refused with the closed message", async () => {
    expect(await addListItem(groupId, you, "Eggs")).toEqual({ ok: false, error: LIST_CLOSED });
    expect(await toggleListItem(groupId, you, itemId)).toEqual({ ok: false, error: LIST_CLOSED });
    expect(await removeListItem(groupId, you, itemId)).toEqual({ ok: false, error: LIST_CLOSED });
    expect(await goingShopping(groupId, you)).toEqual({ ok: false, error: LIST_CLOSED });
  });
  it("the list is exactly as it was: one item, not ticked", async () => {
    const items = await db.listItem.findMany({ where: { groupId } });
    expect(items.map((i) => [i.text, i.boughtAt])).toEqual([["Bread", null]]);
  });
  it("reopened, the same actions work again", async () => {
    await db.group.update({ where: { id: groupId }, data: { closed: false, closedAt: null } });
    expect((await addListItem(groupId, you, "Eggs")).ok).toBe(true);
    expect((await toggleListItem(groupId, you, itemId)).ok).toBe(true);
  });
});
