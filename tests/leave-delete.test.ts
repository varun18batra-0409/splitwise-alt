import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canRestoreGroup } from "@/lib/group-admin";
import { loadDeletedGroups } from "@/lib/group-data";
import { deleteText, leaveText, removeText, RESTORE_NOTE } from "@/lib/leave-text";

// The "What stays / What goes" notes on the leave, remove and delete screens, and
// who is offered Restore for a deleted group (the screen and restoreGroup agree).

const all = (t: { stays: string[]; goes: string[]; extra?: string }) => [...t.stays, ...t.goes, t.extra ?? ""].join("\n");

describe("what stays and what goes", () => {
  it("leaving: your name and the history stay; new expenses, notifications and changes go", () => {
    const t = leaveText();
    expect(t.stays).toEqual([
      "Your name on past expenses and payments",
      "The group’s history, to read (you can download it for 30 days)",
      "Your passport stamp for trips",
    ]);
    expect(t.goes).toEqual(["You won’t be in new expenses", "No notifications from this group", "You can’t add, edit or settle"]);
  });

  it("removing someone says the same about them, and that they can't rejoin on their own or with the old link", () => {
    const t = removeText("Ravi");
    expect(t.stays[0]).toBe("Ravi’s name on past expenses and payments");
    expect(all(t)).toContain("Ravi won’t be in new expenses");
    expect(t.extra).toContain("Ravi can’t rejoin on their own or with the old link");
  });

  it("deleting says what goes for everyone, what stays, and who can restore it", () => {
    const t = deleteText();
    expect(t.goesTitle).toBe("What goes, for everyone");
    expect(t.goes.join(" ")).toContain("disappears from everyone’s Home");
    expect(t.goes.join(" ")).toContain("After 30 days it is erased for good");
    for (const w of ["expenses", "payments", "history", "bills", "list", "budgets", "goals", "deposit record", "group photo", "bill photos"]) expect(t.goes.join(" ")).toContain(w);
    expect(t.goes.join(" ")).toContain("Passport stamps from it disappear");
    expect(t.stays).toEqual(["Postcards already sent", "Collections"]);
    expect(t.extra).toBe(RESTORE_NOTE);
    expect(RESTORE_NOTE).toBe("You can restore it for 30 days.");
  });

  it("no screen still says anyone in a deleted group can restore it", () => {
    const root = path.resolve(__dirname, "..", "src");
    for (const f of ["app/groups/[id]/settings/page.tsx", "app/(home)/page.tsx", "app/privacy/page.tsx", "app/faq/page.tsx", "lib/purge.ts"]) {
      const text = readFileSync(path.join(root, f), "utf8");
      expect(text, f).not.toMatch(/[Aa]nyone in (it|them|these groups) can (restore|bring)/);
    }
  });
});

describe("who can bring a deleted group back", () => {
  const m = (id: string, extra: { claimedAt?: Date; leftAt?: Date } = {}) => ({ id, claimedAt: extra.claimedAt ?? null, leftAt: extra.leftAt ?? null, addedBy: "", seenAt: null });
  const members = [m("asha", { claimedAt: new Date() }), m("ravi", { claimedAt: new Date() }), m("sam", { claimedAt: new Date() })];

  it("the person who deleted it, or whoever looks after the group", () => {
    expect(canRestoreGroup({ deletedById: "asha" }, members, "asha")).toBe(true); // deleted it, and looks after it
    expect(canRestoreGroup({ deletedById: "ravi" }, members, "ravi")).toBe(true); // deleted it
    expect(canRestoreGroup({ deletedById: "ravi" }, members, "asha")).toBe(true); // looks after it
  });
  it("not someone else in the group, not a stranger, and not someone who left", () => {
    expect(canRestoreGroup({ deletedById: "asha" }, members, "sam")).toBe(false);
    expect(canRestoreGroup({ deletedById: "asha" }, members, "nobody")).toBe(false);
    expect(canRestoreGroup({ deletedById: "asha" }, members, undefined)).toBe(false);
    const gone = [m("asha", { claimedAt: new Date(), leftAt: new Date() }), m("ravi", { claimedAt: new Date() })];
    expect(canRestoreGroup({ deletedById: "asha" }, gone, "asha")).toBe(false); // deleted it, then left
  });
});

describe("Restore is offered only to people restoreGroup would accept", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await db.group.deleteMany({ where: { id: { in: ids } } });
  });

  it("Home lists the deleted group for the one who looks after it and for the deleter, not for others or for someone who left", async () => {
    const g = await db.group.create({
      data: {
        name: `Bin test ${Date.now()}`, inviteCode: `bin-${Date.now()}`,
        members: {
          create: [
            { name: "Asha", claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
            { name: "Ravi", claimedAt: new Date() },
            { name: "Sam", claimedAt: new Date() },
            { name: "Zed", claimedAt: new Date(), leftAt: new Date() },
          ],
        },
      },
      include: { members: true },
    });
    ids.push(g.id);
    const id = (n: string) => g.members.find((x) => x.name === n)!.id;
    await db.group.update({ where: { id: g.id }, data: { deletedAt: new Date(), deletedById: id("Asha") } });
    const seen = async (who: string) => (await loadDeletedGroups({ [g.id]: id(who) })).length;
    expect(await seen("Asha")).toBe(1); // deleted it and looks after it
    expect(await seen("Ravi")).toBe(0); // just a member
    expect(await seen("Sam")).toBe(0);
    expect(await seen("Zed")).toBe(0); // left

    // Ravi deleted it (say the admin role changed hands since): he is offered it, Asha still is.
    await db.group.update({ where: { id: g.id }, data: { deletedById: id("Ravi") } });
    expect(await seen("Ravi")).toBe(1);
    expect(await seen("Asha")).toBe(1);
    expect(await seen("Sam")).toBe(0);
    // And someone who deleted it but has since left isn't offered it.
    await db.group.update({ where: { id: g.id }, data: { deletedById: id("Zed") } });
    expect(await seen("Zed")).toBe(0);
  });
});
