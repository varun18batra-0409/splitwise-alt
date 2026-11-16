import { describe, expect, it } from "vitest";
import { leftGroups, leftLine, shortDay } from "@/lib/left-groups";
import { payBlocked } from "@/lib/pay-blocked";

// "Groups you left" on Your groups, and the "closed or left" card on Record a payment: the order, the words and the dates.

const members = [
  { id: "me", name: "Riya" },
  { id: "asha", name: "Asha" },
];
const entry = (type: string, leftAt: string | null, removed = false) => ({
  group: { id: `g-${type}-${leftAt}`, type, members },
  myId: "me",
  leaver: leftAt ? { leftAt: new Date(leftAt), removed } : null,
});

describe("Groups you left: which groups and in what order", () => {
  it("only groups where I left or was removed, newest first", () => {
    const a = entry("trip", "2026-11-16T10:00:00Z"); // 16 Nov
    const b = entry("home", "2026-11-02T10:00:00Z"); // 2 Nov
    const c = entry("trip", "2026-11-10T10:00:00Z", true); // 10 Nov
    const still = entry("trip", null);
    expect(leftGroups([b, still, a, c])).toEqual([a, c, b]);
  });
  it("none left: an empty list, so the folded row is not drawn", () => {
    expect(leftGroups([entry("trip", null), entry("home", null)])).toEqual([]);
  });
});

describe("Groups you left: the quiet line", () => {
  it("left a trip on 16 Nov", () => expect(leftLine(entry("trip", "2026-11-16T10:00:00Z"), "Asia/Kolkata")).toBe("You left on 16 Nov"));
  it("moved out of a flat on 2 Nov", () => expect(leftLine(entry("home", "2026-11-02T10:00:00Z"), "Asia/Kolkata")).toBe("You moved out on 2 Nov"));
  it("removed by someone in the group: names them", () => expect(leftLine(entry("trip", "2026-11-10T10:00:00Z", true), "Asia/Kolkata", "asha")).toBe("Asha removed you on 10 Nov"));
  it("removed, remover unknown (empty or not in the group): says You were removed", () => {
    expect(leftLine(entry("trip", "2026-11-10T10:00:00Z", true), "Asia/Kolkata")).toBe("You were removed on 10 Nov");
    expect(leftLine(entry("trip", "2026-11-10T10:00:00Z", true), "Asia/Kolkata", "ghost")).toBe("You were removed on 10 Nov");
  });
  it("the day is the viewer's own: 22:00 UTC on 15 Nov is already 16 Nov in Kolkata (+5:30)", () => {
    expect(leftLine(entry("trip", "2026-11-15T22:00:00Z"), "Asia/Kolkata")).toBe("You left on 16 Nov");
    expect(leftLine(entry("trip", "2026-11-15T22:00:00Z"), "UTC")).toBe("You left on 15 Nov");
  });
  it("shortDay drops the year and any leading zero", () => expect(shortDay("2026-11-02")).toBe("2 Nov"));
});

describe("Record a payment in a group that can't take one", () => {
  it("open group, still in: no card", () => expect(payBlocked({ name: "Goa 2025", closed: false, leaver: null })).toBeNull());
  it("closed: the title, the text and no talk of leaving", () => {
    const b = payBlocked({ name: "Goa 2025", closed: true, leaver: null })!;
    expect(b.kind).toBe("closed");
    expect(b.title).toBe("Goa 2025 is closed");
    expect(b.text).toBe("You can’t add payments to a closed group. If something’s still owed, an admin can reopen it from Group settings.");
  });
  it("left: You left {Group}", () => {
    const b = payBlocked({ name: "Koh Samui", closed: false, leaver: { removed: false } })!;
    expect([b.kind, b.title, b.text]).toEqual(["left", "You left Koh Samui", "Only people still in the group can record payments here."]);
  });
  it("removed: says removed, never 'rejoin'", () => {
    const b = payBlocked({ name: "Koh Samui", closed: false, leaver: { removed: true } })!;
    expect(b.title).toBe("You were removed from Koh Samui");
    expect(b.text).not.toMatch(/rejoin/i);
  });
  it("closed AND left: the leaver's card wins (they could not reopen it anyway)", () => {
    expect(payBlocked({ name: "Koh Samui", closed: true, leaver: { removed: false } })!.kind).toBe("left");
  });
});
